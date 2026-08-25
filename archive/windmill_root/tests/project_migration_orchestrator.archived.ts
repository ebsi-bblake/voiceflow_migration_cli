import { describe, expect, mock, test } from "bun:test";

import type { AuthContext } from "../jwt_authentication_context";
import type {
  ExportArtifact,
  ImportReceipt,
  MigrationResult,
} from "../shared_contract_types";

type Scenario =
  | "success"
  | "authentication-failure"
  | "export-failure"
  | "import-failure"
  | "api-key-failure";

type RecordedArtifact = {
  status: ExportArtifact["status"];
  filename: ExportArtifact["filename"];
  contentType: ExportArtifact["contentType"];
  bytes: number[];
  byteLength: number;
};

type RecordedCalls = {
  authenticate: Array<{ token: string }>;
  export: Array<{ auth: AuthContext; sourceVersionID: string }>;
  import: Array<{
    auth: AuthContext;
    artifact: RecordedArtifact;
    destinationWorkspaceID: string;
    folderID: string;
    targetSchemaVersion: string;
  }>;
  apiKey: Array<{ auth: AuthContext; projectID: string }>;
};

type ScenarioReport = {
  effects: string[];
  calls: RecordedCalls;
  outcome:
    | {
        kind: "fulfilled";
        result: MigrationResult;
        resultKeys: string[];
      }
    | {
        kind: "rejected";
        message: string;
        rejectedWithScenarioError: boolean;
      };
};

const scenarioEnvironmentVariable =
  "PROJECT_MIGRATION_ORCHESTRATOR_TEST_SCENARIO";
const apiKeyMaterial = "VF.DM.must-not-escape";
const rawApiKeyFailureMessage = `identity response exposed ${apiKeyMaterial}`;

const auth: AuthContext = {
  token: "authenticated-token",
  creatorID: "creator-id",
};

const artifact: ExportArtifact = {
  bytes: new Uint8Array([1, 2, 3, 4]).buffer,
  filename: "voiceflow-export.vf",
  contentType: "application/octet-stream",
  status: 200,
};

const receipt: ImportReceipt = {
  projectID: "imported-project",
  devVersion: "development-version",
  liveVersion: "live-version",
  assistantID: "assistant-id",
  folderID: "destination-folder",
  workspaceID: "destination-workspace",
  sourceProjectID: "source-project",
};

const rawSelectionArguments = [
  " token-input ",
  " source-workspace ",
  " source-project ",
  " source-version ",
  " destination-workspace ",
  " destination-folder ",
  "13.1",
] as const;

const normalizedSelection = {
  sourceWorkspaceID: "source-workspace",
  sourceProjectID: "source-project",
  sourceVersionID: "source-version",
  destinationWorkspaceID: "destination-workspace",
  destinationFolderID: "destination-folder",
};

const expectedSuccessfulResult: MigrationResult = {
  exportStatus: artifact.status,
  importStatus: 201,
  exportBytes: artifact.bytes.byteLength,
  selected: normalizedSelection,
  imported: receipt,
  apiKeyRetrieved: true,
  postImport: undefined,
};

const expectedEffects = ["authenticate", "export", "import", "API-key"];
const expectedSuccessfulResultKeys = new Set([
  "exportStatus",
  "importStatus",
  "exportBytes",
  "selected",
  "imported",
  "apiKeyRetrieved",
  "postImport",
]);

const expectedCalls: RecordedCalls = {
  authenticate: [{ token: rawSelectionArguments[0] }],
  export: [{ auth, sourceVersionID: normalizedSelection.sourceVersionID }],
  import: [
    {
      auth,
      artifact: {
        status: artifact.status,
        filename: artifact.filename,
        contentType: artifact.contentType,
        bytes: [1, 2, 3, 4],
        byteLength: artifact.bytes.byteLength,
      },
      destinationWorkspaceID: normalizedSelection.destinationWorkspaceID,
      folderID: normalizedSelection.destinationFolderID,
      targetSchemaVersion: rawSelectionArguments[6],
    },
  ],
  apiKey: [{ auth, projectID: receipt.projectID }],
};

function emptyRecordedCalls(): RecordedCalls {
  return {
    authenticate: [],
    export: [],
    import: [],
    apiKey: [],
  };
}

function isScenario(value: string): value is Scenario {
  return [
    "success",
    "authentication-failure",
    "export-failure",
    "import-failure",
    "api-key-failure",
  ].includes(value);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordArtifact(artifactToRecord: ExportArtifact): RecordedArtifact {
  return {
    status: artifactToRecord.status,
    filename: artifactToRecord.filename,
    contentType: artifactToRecord.contentType,
    bytes: Array.from(new Uint8Array(artifactToRecord.bytes)),
    byteLength: artifactToRecord.bytes.byteLength,
  };
}

async function executeMockedScenario(scenario: Scenario): Promise<ScenarioReport> {
  const effects: string[] = [];
  const calls = emptyRecordedCalls();
  const authenticationFailure = new Error("authentication failed");
  const exportFailure = new Error("export failed");
  const importFailure = new Error("import failed");
  const apiKeyFailure = new Error(rawApiKeyFailureMessage);
  const scenarioFailure =
    scenario === "authentication-failure"
      ? authenticationFailure
      : scenario === "export-failure"
        ? exportFailure
        : scenario === "import-failure"
          ? importFailure
          : undefined;

  const authenticate = mock((token: string): AuthContext => {
    effects.push("authenticate");
    calls.authenticate.push({ token });
    if (scenario === "authentication-failure") throw authenticationFailure;
    return auth;
  });

  const exportVersion = mock(
    async (actualAuth: AuthContext, sourceVersionID: string) => {
      effects.push("export");
      calls.export.push({ auth: actualAuth, sourceVersionID });
      if (scenario === "export-failure") throw exportFailure;
      return artifact;
    },
  );

  const importFile = mock(
    async (
      actualAuth: AuthContext,
      request: {
        artifact: ExportArtifact;
        destinationWorkspaceID: string;
        folderID: string;
        targetSchemaVersion: string;
      },
    ) => {
      effects.push("import");
      calls.import.push({
        auth: actualAuth,
        artifact: recordArtifact(request.artifact),
        destinationWorkspaceID: request.destinationWorkspaceID,
        folderID: request.folderID,
        targetSchemaVersion: request.targetSchemaVersion,
      });
      if (scenario === "import-failure") throw importFailure;
      return { status: 201, receipt };
    },
  );

  const retrieveProjectApiKey = mock(
    async (actualAuth: AuthContext, projectID: string) => {
      effects.push("API-key");
      calls.apiKey.push({ auth: actualAuth, projectID });
      if (scenario === "api-key-failure") throw apiKeyFailure;
      return apiKeyMaterial;
    },
  );

  mock.module("../jwt_authentication_context", () => ({ authenticate }));
  mock.module("../export_project_api", () => ({ exportVersion }));
  mock.module("../import_project_api", () => ({ importFile }));
  mock.module("../project_api_key_retrieval", () => ({
    retrieveProjectApiKey,
  }));

  const { migrateProject } = await import("../project_migration_orchestrator");

  try {
    const result = await migrateProject(...rawSelectionArguments);
    return {
      effects,
      calls,
      outcome: {
        kind: "fulfilled",
        result,
        resultKeys: Object.keys(result),
      },
    };
  } catch (error) {
    return {
      effects,
      calls,
      outcome: {
        kind: "rejected",
        message: messageFrom(error),
        rejectedWithScenarioError: error === scenarioFailure,
      },
    };
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function expectUnorderedSuccessfulResultKeys(report: ScenarioReport): void {
  if (report.outcome.kind !== "fulfilled") {
    throw new Error("Expected a fulfilled orchestrator scenario");
  }
  expect(new Set(report.outcome.resultKeys)).toEqual(
    expectedSuccessfulResultKeys,
  );
}

function executeScenarioInIsolatedProcess(scenario: Scenario): ScenarioReport {
  const child = Bun.spawnSync([process.execPath, "run", import.meta.path], {
    env: {
      ...process.env,
      [scenarioEnvironmentVariable]: scenario,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = decode(child.stderr).trim();
  const stdout = decode(child.stdout).trim();

  if (child.exitCode !== 0) {
    throw new Error(
      `Isolated orchestrator scenario failed with exit ${child.exitCode}: ${stderr}`,
    );
  }
  if (!stdout) throw new Error("Isolated orchestrator scenario returned no report");
  return JSON.parse(stdout) as ScenarioReport;
}

const requestedScenario = process.env[scenarioEnvironmentVariable];

if (requestedScenario !== undefined) {
  if (!isScenario(requestedScenario)) {
    throw new Error(`Unknown orchestrator scenario: ${requestedScenario}`);
  }

  const report = await executeMockedScenario(requestedScenario);
  process.stdout.write(JSON.stringify(report));
} else {
  describe("project migration orchestrator", () => {
    test("runs effects in order and returns the exact key-free success result with normalized IDs", () => {
      const report = executeScenarioInIsolatedProcess("success");

      expect(report).toEqual({
        effects: expectedEffects,
        calls: expectedCalls,
        outcome: {
          kind: "fulfilled",
          result: {
            ...expectedSuccessfulResult,
            postImport: undefined,
          },
          resultKeys: expect.any(Array),
        },
      });
      expectUnorderedSuccessfulResultKeys(report);
      expect(JSON.stringify(report)).not.toContain(apiKeyMaterial);
    });

    test("stops after authentication failure and preserves the rejection", () => {
      const report = executeScenarioInIsolatedProcess("authentication-failure");

      expect(report).toEqual({
        effects: ["authenticate"],
        calls: {
          authenticate: expectedCalls.authenticate,
          export: [],
          import: [],
          apiKey: [],
        },
        outcome: {
          kind: "rejected",
          message: "authentication failed",
          rejectedWithScenarioError: true,
        },
      });
    });

    test("stops after export failure and preserves the rejection", () => {
      const report = executeScenarioInIsolatedProcess("export-failure");

      expect(report).toEqual({
        effects: ["authenticate", "export"],
        calls: {
          authenticate: expectedCalls.authenticate,
          export: expectedCalls.export,
          import: [],
          apiKey: [],
        },
        outcome: {
          kind: "rejected",
          message: "export failed",
          rejectedWithScenarioError: true,
        },
      });
    });

    test("stops after import failure and preserves the rejection", () => {
      const report = executeScenarioInIsolatedProcess("import-failure");

      expect(report).toEqual({
        effects: ["authenticate", "export", "import"],
        calls: {
          authenticate: expectedCalls.authenticate,
          export: expectedCalls.export,
          import: expectedCalls.import,
          apiKey: [],
        },
        outcome: {
          kind: "rejected",
          message: "import failed",
          rejectedWithScenarioError: true,
        },
      });
    });

    test("keeps API-key failure nonfatal and returns only the sanitized diagnostic", () => {
      const report = executeScenarioInIsolatedProcess("api-key-failure");

      expect(report).toEqual({
        effects: expectedEffects,
        calls: expectedCalls,
        outcome: {
          kind: "fulfilled",
          result: {
            ...expectedSuccessfulResult,
            apiKeyRetrieved: false,
            postImport: {
              apiKeyRetrieved: false,
              diagnostic: {
                phase: "API-key retrieval",
                endpoint: "unknown",
                code: "unknown",
                retryable: false,
                diagnosticId: expect.any(String),
                nextAction: "Check the migration inputs and response.",
              },
            },
          },
          resultKeys: expect.any(Array),
        },
      });
      expectUnorderedSuccessfulResultKeys(report);
      expect(JSON.stringify(report)).not.toContain(rawApiKeyFailureMessage);
      expect(JSON.stringify(report)).not.toContain(apiKeyMaterial);
    });
  });
}
