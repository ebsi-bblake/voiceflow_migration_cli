import { describe, expect, mock, test } from "bun:test";

import {
  resolveVoiceflowAuth,
  type AuthContext,
} from "../xyops/voiceflow/vf_auth";
import type {
  MigrationPlan,
  MigrationSelection,
} from "../xyops/voiceflow/vf_contracts";

const planningScenarioEnvironmentVariable =
  "VF_AUTH_PLANNING_FP_CATALOG_SCENARIO";
const expectedPlanID = "e1967925069d43387fd5b659";

const normalizedSelection: MigrationSelection = {
  sourceWorkspaceID: "source-workspace",
  sourceProjectID: "source-project",
  sourceVersionID: "source-version",
  destinationWorkspaceID: "destination-workspace",
  destinationFolderID: "42",
  targetSchemaVersion: "13.1",
};

const paddedSelection: MigrationSelection = {
  sourceWorkspaceID: "  source-workspace ",
  sourceProjectID: " source-project  ",
  sourceVersionID: "\tsource-version\n",
  destinationWorkspaceID: " destination-workspace ",
  destinationFolderID: " 42 ",
  targetSchemaVersion: " 13.1 ",
};

const expectedLabels = {
  sourceWorkspace: "Source Workspace",
  sourceProject: "Source Project",
  sourceVersion: "[Draft] Source Project — Development",
  destinationWorkspace: "Destination Workspace",
  destinationFolder: "Destination Folder",
};

type PlanningScenarioResult = {
  readonly first: MigrationPlan;
  readonly repeated: MigrationPlan;
  readonly changed: MigrationPlan;
};

type PlanningScenario = "catalog";

function encodeClaims(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${payload}.signature`;
}

async function expectAuthenticationFailure(input: unknown): Promise<void> {
  const result = resolveVoiceflowAuth(input);

  expect(result).toBeInstanceOf(Promise);
  await expect(result).rejects.toMatchObject({
    code: "AUTHENTICATION_FAILED",
    message: "Authentication failed.",
    retryable: false,
  });
}

function catalogRows(type: string | undefined): readonly unknown[] {
  if (type === "workspace.CRUD:REPLACE") {
    return [
      { id: "source-workspace", name: "Source Workspace" },
      { id: "destination-workspace", name: "Destination Workspace" },
    ];
  }
  if (type === "project.CRUD:REPLACE") {
    return [
      {
        id: "source-project",
        workspaceID: "source-workspace",
        name: "Source Project",
        environments: [
          { name: "Development", draftVersionID: "source-version" },
        ],
      },
    ];
  }
  if (type === "workspace-folder.REPLACE") {
    return [
      {
        id: 42,
        workspaceID: "destination-workspace",
        name: "Destination Folder",
      },
    ];
  }
  throw new Error(`Unexpected catalog type: ${String(type)}`);
}

function installIsolatedCatalogMock(): void {
  const syncCatalog = async (
    _auth: AuthContext,
    _channel: string,
    wanted: string[],
  ): Promise<readonly unknown[]> => catalogRows(wanted[0]);

  mock.module("../xyops/voiceflow/vf_logux", () => ({ syncCatalog }));
}

async function runIsolatedPlanningScenario(): Promise<PlanningScenarioResult> {
  installIsolatedCatalogMock();
  const { buildMigrationPlan } = await import("../xyops/voiceflow/vf_planning");
  const auth: AuthContext = { token: "token", creatorID: "creator" };
  const changedSelection = {
    ...paddedSelection,
    targetSchemaVersion: " 13.2 ",
  };

  const first = await buildMigrationPlan(auth, paddedSelection);
  const repeated = await buildMigrationPlan(auth, paddedSelection);
  const changed = await buildMigrationPlan(auth, changedSelection);
  return { first, repeated, changed };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

let cachedPlanningScenario: PlanningScenarioResult | undefined;

function scenarioResultFromIsolatedProcess<Result>(
  scenario: PlanningScenario,
): Result {
  const child = Bun.spawnSync([process.execPath, "run", import.meta.path], {
    env: {
      ...process.env,
      [planningScenarioEnvironmentVariable]: scenario,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = decode(child.stderr).trim();
  const stdout = decode(child.stdout).trim();

  if (child.exitCode !== 0) {
    throw new Error(
      `Isolated ${scenario} scenario failed with exit ${child.exitCode}: ${stderr}`,
    );
  }
  if (!stdout) throw new Error(`Isolated ${scenario} scenario returned no result`);
  return JSON.parse(stdout) as Result;
}

function planningScenarioFromIsolatedProcess(): PlanningScenarioResult {
  if (cachedPlanningScenario) return cachedPlanningScenario;

  cachedPlanningScenario =
    scenarioResultFromIsolatedProcess<PlanningScenarioResult>("catalog");
  return cachedPlanningScenario;
}

const requestedPlanningScenario =
  process.env[planningScenarioEnvironmentVariable];

if (requestedPlanningScenario !== undefined) {
  let result: PlanningScenarioResult;
  if (requestedPlanningScenario === "catalog") {
    result = await runIsolatedPlanningScenario();
  } else {
    throw new Error(`Unknown isolated planning scenario: ${requestedPlanningScenario}`);
  }
  process.stdout.write(JSON.stringify(result));
} else {
  describe("resolveVoiceflowAuth functional contract", () => {
    test("resolves raw and Bearer tokens to the same normalized auth context", async () => {
      const token = encodeClaims({ sub: "creator-1" });
      const rawResult = resolveVoiceflowAuth(token);
      const bearerResult = resolveVoiceflowAuth(`  bEaReR   ${token}  `);

      expect(rawResult).toBeInstanceOf(Promise);
      expect(bearerResult).toBeInstanceOf(Promise);
      await expect(rawResult).resolves.toEqual({
        token,
        creatorID: "creator-1",
      });
      await expect(bearerResult).resolves.toEqual({
        token,
        creatorID: "creator-1",
      });
    });

    for (const [name, input] of [
      ["malformed token shape", "not-a-jwt"],
      ["malformed token payload", "header.***.signature"],
      ["non-string input", { token: encodeClaims({ sub: "creator" }) }],
      ["Promise-valued input", Promise.resolve(encodeClaims({ sub: "creator" }))],
    ] as const) {
      test(`rejects ${name} through its Promise contract`, () =>
        expectAuthenticationFailure(input));
    }

    for (const alias of ["creatorID", "userID", "user_id", "sub"] as const) {
      test(`accepts the ${alias} creator claim alias`, async () => {
        const token = encodeClaims({ [alias]: `${alias}-value` });

        await expect(resolveVoiceflowAuth(token)).resolves.toEqual({
          token,
          creatorID: `${alias}-value`,
        });
      });
    }

    for (const creatorID of [
      "auth0|123456",
      "creator=id",
      "creator-id",
      "creator.id",
    ]) {
      test(`accepts creator ID ${creatorID}`, async () => {
        const token = encodeClaims({ sub: creatorID });

        await expect(resolveVoiceflowAuth(token)).resolves.toEqual({
          token,
          creatorID,
        });
      });
    }

    for (const { claims, expected } of [
      {
        claims: {
          creatorID: "creator-id",
          userID: "user-id",
          user_id: "user-id-alias",
          sub: "subject",
        },
        expected: "creator-id",
      },
      {
        claims: {
          userID: "user-id",
          user_id: "user-id-alias",
          sub: "subject",
        },
        expected: "user-id",
      },
      {
        claims: { user_id: "user-id-alias", sub: "subject" },
        expected: "user-id-alias",
      },
    ] as const) {
      test(`uses ${expected} according to creator claim precedence`, async () => {
        const token = encodeClaims(claims);

        await expect(resolveVoiceflowAuth(token)).resolves.toMatchObject({
          creatorID: expected,
        });
      });
    }

    test("normalizes a numeric creator ID to a string", async () => {
      const token = encodeClaims({ creatorID: 42 });

      await expect(resolveVoiceflowAuth(token)).resolves.toEqual({
        token,
        creatorID: "42",
      });
    });

    test("rejects a blank highest-precedence creator ID instead of falling back", () => {
      const token = encodeClaims({ creatorID: "   ", sub: "fallback" });

      return expectAuthenticationFailure(token);
    });

    for (const creatorID of [
      "",
      "creator\nID",
      "creator/ID",
      "creator\\ID",
      "x".repeat(129),
    ]) {
      test(`rejects unsafe creator ID ${JSON.stringify(creatorID)}`, () =>
        expectAuthenticationFailure(encodeClaims({ sub: creatorID })));
    }
  });

  describe("buildMigrationPlan functional contract", () => {
    test("returns the exact golden ID and labels for a normalized selection", () => {
      const { first } = planningScenarioFromIsolatedProcess();

      expect(first).toEqual({
        planID: expectedPlanID,
        selection: normalizedSelection,
        labels: expectedLabels,
      });
      expect(first.planID).toMatch(/^[a-f0-9]{24}$/);
    });

    test("is stable for the same selection and changes for a changed selection", () => {
      const { first, repeated, changed } = planningScenarioFromIsolatedProcess();

      expect(repeated).toEqual(first);
      expect(changed.selection).toEqual({
        ...normalizedSelection,
        targetSchemaVersion: "13.2",
      });
      expect(changed.planID).toMatch(/^[a-f0-9]{24}$/);
      expect(changed.planID).not.toBe(first.planID);
    });

  });
}
