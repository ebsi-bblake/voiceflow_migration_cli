import { afterEach, describe, expect, test } from "bun:test";

import {
  buildOptions,
  listFolders,
  listProjects,
  listVersions,
  listWorkspaces,
} from "../catalog_discovery_service";
import { authenticate } from "../jwt_authentication_context";
import { sync } from "../logux_websocket_transport";
import {
  MigrationError,
  type MigrationCode,
  type MigrationDiagnostic,
  type MigrationPhase,
} from "../migration_diagnostics";
import {
  destinationFolderID,
  destinationWorkspaceID,
  sourceProjectID,
  sourceVersionID,
  sourceWorkspaceID,
} from "../windmill_dynamic_selectors";

const TOKEN = "header.eyJzdWIiOiJjcmVhdG9yLTEifQ.signature";
const originalWebSocket = globalThis.WebSocket;

type CatalogActionType =
  | "workspace.CRUD:REPLACE"
  | "project.CRUD:REPLACE"
  | "workspace-folder.REPLACE";

type CatalogFrame = Readonly<{
  type: CatalogActionType;
  rows: readonly unknown[];
}>;

type SocketObservation = Readonly<{
  urls: string[];
  sentFrames: unknown[][];
  closeCount: () => number;
  restore: () => void;
}>;

type StableMigrationDiagnostic = Omit<MigrationDiagnostic, "diagnosticId">;

function encodeBase64Url(text: string): string {
  return btoa(text)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function tokenForClaims(claims: unknown): string {
  return `header.${encodeBase64Url(JSON.stringify(claims))}.signature`;
}

function captureMigrationError(operation: () => unknown): MigrationError {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(MigrationError);
  return captured as MigrationError;
}

async function captureRejectedMigrationError(
  operation: Promise<unknown>,
): Promise<MigrationError> {
  const captured = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(captured).toBeInstanceOf(MigrationError);
  return captured as MigrationError;
}

function expectDiagnostic(
  error: MigrationError,
  phase: MigrationPhase,
  code: MigrationCode,
): void {
  expect(error.diagnostic.phase).toBe(phase);
  expect(error.diagnostic.code).toBe(code);
}

function payloadForFrame(frame: CatalogFrame): Record<string, unknown> {
  return frame.type === "workspace-folder.REPLACE"
    ? { data: [...frame.rows] }
    : { values: [...frame.rows] };
}

function installCatalogWebSocket(frames: readonly CatalogFrame[]): SocketObservation {
  const previousWebSocket = globalThis.WebSocket;
  const urls: string[] = [];
  const sentFrames: unknown[][] = [];
  let closedSockets = 0;

  class CatalogWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string | URL) {
      urls.push(String(url));
      queueMicrotask(() => this.onopen?.());
    }

    send(serializedFrame: string): void {
      const frame = JSON.parse(serializedFrame) as unknown[];
      sentFrames.push(frame);
      if (frame[0] === "connect") {
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify(["connected"]) });
        });
        return;
      }
      if (frame[0] !== "sync") return;
      queueMicrotask(() => {
        for (const catalogFrame of frames) {
          this.onmessage?.({
            data: JSON.stringify([
              "sync",
              1,
              {
                type: catalogFrame.type,
                payload: payloadForFrame(catalogFrame),
              },
            ]),
          });
        }
      });
    }

    close(): void {
      closedSockets += 1;
    }
  }

  globalThis.WebSocket = CatalogWebSocket as unknown as typeof WebSocket;
  return {
    urls,
    sentFrames,
    closeCount: () => closedSockets,
    restore: () => {
      globalThis.WebSocket = previousWebSocket;
    },
  };
}

function expectPromise(value: unknown): asserts value is Promise<unknown> {
  expect(value).toBeInstanceOf(Promise);
  expect(typeof (value as Promise<unknown>).then).toBe("function");
}

async function expectRejectedPromiseDiagnostic(
  operation: () => unknown,
  expectedDiagnostic: StableMigrationDiagnostic,
): Promise<void> {
  let result: unknown;
  expect(() => {
    result = operation();
  }).not.toThrow();
  expectPromise(result);

  const error = await captureRejectedMigrationError(result);
  const { diagnosticId, ...stableDiagnostic } = error.diagnostic;
  expect(diagnosticId).not.toBe("");
  expect(stableDiagnostic).toEqual(expectedDiagnostic);
}

function expectedAuthenticationDiagnostic(
  code: "invalid-input" | "authentication-failed",
): StableMigrationDiagnostic {
  return {
    phase: "Authentication",
    endpoint: "unknown",
    code,
    retryable: false,
    nextAction: "Check the migration inputs and response.",
  };
}

function expectedInvalidCatalogIDDiagnostic(
  idName: "workspace ID" | "project ID",
): StableMigrationDiagnostic {
  return {
    phase: "Catalog",
    endpoint: "catalog",
    code: "invalid-input",
    retryable: false,
    nextAction: `Provide a valid ${idName}.`,
  };
}

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe("root authentication contract", () => {
  test("trims the token while preserving the selected creator identity", () => {
    const token = tokenForClaims({ creatorID: "creator-1" });

    expect(authenticate(` \n${token}\t `)).toEqual({
      token,
      creatorID: "creator-1",
    });
  });

  for (const [alias, value] of [
    ["creatorID", "creator-alias"],
    ["userID", "user-alias"],
    ["user_id", "snake-alias"],
    ["sub", "subject-alias"],
  ] as const) {
    test(`accepts the ${alias} identity alias`, () => {
      expect(authenticate(tokenForClaims({ [alias]: value })).creatorID).toBe(
        value,
      );
    });
  }

  test("selects identity aliases in creatorID, userID, user_id, sub precedence", () => {
    expect(
      authenticate(
        tokenForClaims({
          creatorID: "creator-first",
          userID: "user-second",
          user_id: "snake-third",
          sub: "subject-fourth",
        }),
      ).creatorID,
    ).toBe("creator-first");
    expect(
      authenticate(
        tokenForClaims({
          creatorID: null,
          userID: "user-second",
          user_id: "snake-third",
          sub: "subject-fourth",
        }),
      ).creatorID,
    ).toBe("user-second");
    expect(
      authenticate(
        tokenForClaims({
          userID: null,
          user_id: "snake-third",
          sub: "subject-fourth",
        }),
      ).creatorID,
    ).toBe("snake-third");
    expect(
      authenticate(
        tokenForClaims({ user_id: null, sub: "subject-fourth" }),
      ).creatorID,
    ).toBe("subject-fourth");
  });

  test("accepts numeric identities including zero", () => {
    expect(authenticate(tokenForClaims({ creatorID: 0 })).creatorID).toBe("0");
    expect(authenticate(tokenForClaims({ sub: 42 })).creatorID).toBe("42");
  });

  for (const claims of [
    { creatorID: "" },
    { creatorID: "   " },
    { creatorID: "", sub: "lower-priority-is-not-used" },
  ]) {
    test(`rejects blank selected identity ${JSON.stringify(claims)}`, () => {
      const error = captureMigrationError(() =>
        authenticate(tokenForClaims(claims)),
      );
      expectDiagnostic(error, "Authentication", "authentication-failed");
    });
  }

  for (const rawToken of [undefined, null, 17, "", " \n\t "]) {
    test(`rejects invalid raw token input ${JSON.stringify(rawToken)}`, () => {
      const error = captureMigrationError(() => authenticate(rawToken));
      expectDiagnostic(error, "Authentication", "invalid-input");
    });
  }

  for (const malformedToken of [
    "one.two",
    "one.two.three.four",
    "one..three",
    "one.tw=o.three",
  ]) {
    test(`rejects malformed JWT segments: ${malformedToken}`, () => {
      const error = captureMigrationError(() => authenticate(malformedToken));
      expectDiagnostic(error, "Authentication", "authentication-failed");
    });
  }

  test("rejects a malformed base64url claims segment", () => {
    const error = captureMigrationError(() =>
      authenticate("header.a.signature"),
    );
    expectDiagnostic(error, "Authentication", "authentication-failed");
  });

  test("rejects malformed JSON claims", () => {
    const malformedJSON = encodeBase64Url('{"sub":');
    const error = captureMigrationError(() =>
      authenticate(`header.${malformedJSON}.signature`),
    );
    expectDiagnostic(error, "Authentication", "authentication-failed");
  });

  for (const claims of [null, [], "claims", 7, true]) {
    test(`rejects non-object claims ${JSON.stringify(claims)}`, () => {
      const error = captureMigrationError(() =>
        authenticate(tokenForClaims(claims)),
      );
      expectDiagnostic(error, "Authentication", "authentication-failed");
    });
  }
});

describe("root Logux and catalog contracts", () => {
  test("listProjects rejects invalid public inputs as Promises without opening a socket", async () => {
    const previousWebSocket = globalThis.WebSocket;
    let constructorCalls = 0;
    class ForbiddenWebSocket {
      constructor() {
        constructorCalls += 1;
        throw new Error("invalid listProjects inputs must not open a WebSocket");
      }
    }
    globalThis.WebSocket = ForbiddenWebSocket as unknown as typeof WebSocket;

    try {
      await expectRejectedPromiseDiagnostic(
        () => listProjects(" \n\t ", "workspace-1"),
        expectedAuthenticationDiagnostic("invalid-input"),
      );
      await expectRejectedPromiseDiagnostic(
        () => listProjects("not-a-jwt", "workspace-1"),
        expectedAuthenticationDiagnostic("authentication-failed"),
      );
      for (const workspaceID of [" ", "workspace/id"]) {
        await expectRejectedPromiseDiagnostic(
          () => listProjects(TOKEN, workspaceID),
          expectedInvalidCatalogIDDiagnostic("workspace ID"),
        );
      }
      expect(constructorCalls).toBe(0);
    } finally {
      globalThis.WebSocket = previousWebSocket;
    }
  });

  test("listVersions rejects invalid public inputs as Promises without opening a socket", async () => {
    const previousWebSocket = globalThis.WebSocket;
    let constructorCalls = 0;
    class ForbiddenWebSocket {
      constructor() {
        constructorCalls += 1;
        throw new Error("invalid listVersions inputs must not open a WebSocket");
      }
    }
    globalThis.WebSocket = ForbiddenWebSocket as unknown as typeof WebSocket;

    try {
      await expectRejectedPromiseDiagnostic(
        () => listVersions(" \n\t ", "workspace-1", "project-1"),
        expectedAuthenticationDiagnostic("invalid-input"),
      );
      await expectRejectedPromiseDiagnostic(
        () => listVersions("not-a-jwt", "workspace-1", "project-1"),
        expectedAuthenticationDiagnostic("authentication-failed"),
      );
      for (const workspaceID of [" ", "workspace/id"]) {
        await expectRejectedPromiseDiagnostic(
          () => listVersions(TOKEN, workspaceID, "project-1"),
          expectedInvalidCatalogIDDiagnostic("workspace ID"),
        );
      }
      for (const projectID of ["\t", "project/id"]) {
        await expectRejectedPromiseDiagnostic(
          () => listVersions(TOKEN, "workspace-1", projectID),
          expectedInvalidCatalogIDDiagnostic("project ID"),
        );
      }
      expect(constructorCalls).toBe(0);
    } finally {
      globalThis.WebSocket = previousWebSocket;
    }
  });

  test("listFolders rejects invalid public inputs as Promises without opening a socket", async () => {
    const previousWebSocket = globalThis.WebSocket;
    let constructorCalls = 0;
    class ForbiddenWebSocket {
      constructor() {
        constructorCalls += 1;
        throw new Error("invalid listFolders inputs must not open a WebSocket");
      }
    }
    globalThis.WebSocket = ForbiddenWebSocket as unknown as typeof WebSocket;

    try {
      await expectRejectedPromiseDiagnostic(
        () => listFolders(" \n\t ", "workspace-1"),
        expectedAuthenticationDiagnostic("invalid-input"),
      );
      await expectRejectedPromiseDiagnostic(
        () => listFolders("not-a-jwt", "workspace-1"),
        expectedAuthenticationDiagnostic("authentication-failed"),
      );
      for (const workspaceID of ["\n", "workspace/id"]) {
        await expectRejectedPromiseDiagnostic(
          () => listFolders(TOKEN, workspaceID),
          expectedInvalidCatalogIDDiagnostic("workspace ID"),
        );
      }
      expect(constructorCalls).toBe(0);
    } finally {
      globalThis.WebSocket = previousWebSocket;
    }
  });

  test("rejects empty, unsupported, and mixed wanted action lists before opening a socket", async () => {
    const previousWebSocket = globalThis.WebSocket;
    let constructorCalls = 0;
    class ForbiddenWebSocket {
      constructor() {
        constructorCalls += 1;
        throw new Error("invalid wanted actions must not open a WebSocket");
      }
    }
    globalThis.WebSocket = ForbiddenWebSocket as unknown as typeof WebSocket;

    try {
      for (const wanted of [
        [],
        ["unsupported"],
        ["workspace.CRUD:REPLACE", "unsupported"],
      ]) {
        const error = await captureRejectedMigrationError(
          sync(
            { creatorID: "creator-1", token: TOKEN },
            "creator/creator-1",
            wanted,
          ),
        );
        expectDiagnostic(error, "Catalog", "invalid-input");
        expect(error.diagnostic.endpoint).toBe("catalog");
      }
      expect(constructorCalls).toBe(0);
    } finally {
      globalThis.WebSocket = previousWebSocket;
    }
  });

  test("returns only object rows from the requested Logux catalog action", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "workspace.CRUD:REPLACE",
        rows: [
          { id: "workspace-1" },
          null,
          "malformed",
          7,
          false,
          [],
          { id: "workspace-2" },
        ],
      },
    ]);

    try {
      await expect(
        sync(
          { creatorID: "creator-1", token: TOKEN },
          "creator/creator-1",
          ["workspace.CRUD:REPLACE"],
        ),
      ).resolves.toEqual([{ id: "workspace-1" }, { id: "workspace-2" }]);
      expect(socket.urls).toEqual(["wss://realtime.empyrean.voiceflow.com/"]);
      expect(socket.closeCount()).toBe(1);
    } finally {
      socket.restore();
    }
  });

  test("filters malformed workspaces and keeps the last duplicate before deterministic ordering", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "workspace.CRUD:REPLACE",
        rows: [
          { id: " workspace-z ", name: " Zulu Workspace " },
          { id: 2, title: " Alpha Workspace " },
          { id: "duplicate", name: "Zulu Duplicate" },
          { id: "Delta" },
          { id: "duplicate", name: " Beta Duplicate " },
          { id: " ", name: "Blank ID" },
          { name: "Missing ID" },
          null,
          "malformed",
          [],
        ],
      },
    ]);

    try {
      await expect(listWorkspaces(TOKEN)).resolves.toEqual([
        { value: "2", label: "Alpha Workspace" },
        { value: "duplicate", label: "Beta Duplicate" },
        { value: "Delta", label: "Delta" },
        { value: "workspace-z", label: "Zulu Workspace" },
      ]);
      expect(
        buildOptions([
          { id: "b", name: "Same" },
          { id: "a", name: "Same" },
        ]),
      ).toEqual([
        { value: "a", label: "Same" },
        { value: "b", label: "Same" },
      ]);
    } finally {
      socket.restore();
    }
  });

  test("filters projects to the normalized workspace and sorts their options", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "project.CRUD:REPLACE",
        rows: [
          { id: "z-project", workspaceID: "w1", name: "Zulu Project" },
          { id: "alpha-project", workspaceID: "w1", title: "Alpha Project" },
          { id: 3, workspaceID: "w1", name: "Numeric Project" },
          { id: "other", workspaceID: "w2", name: "Other Workspace" },
          { id: "untrimmed", workspaceID: " w1 ", name: "Untrimmed Scope" },
          { id: "missing-workspace", name: "Missing Workspace" },
          { id: " ", workspaceID: "w1", name: "Blank ID" },
          null,
          [],
        ],
      },
    ]);

    try {
      await expect(listProjects(TOKEN, " w1 ")).resolves.toEqual([
        { value: "alpha-project", label: "Alpha Project" },
        { value: "3", label: "Numeric Project" },
        { value: "z-project", label: "Zulu Project" },
      ]);
    } finally {
      socket.restore();
    }
  });

  test("filters folders by numeric ID, workspace, nonblank name, and assistant scope", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "workspace-folder.REPLACE",
        rows: [
          { id: 20, workspaceID: "w1", name: "Zulu Folder" },
          { id: "007", workspaceID: "w1", name: "Alpha Folder", scope: "assistant" },
          { id: 0, workspaceID: "w1", name: "Zero Folder" },
          { id: "8", workspaceID: "w1", name: "   " },
          { id: "9", workspaceID: "w1", title: "Title Is Not A Folder Name" },
          { id: "10", workspaceID: "w1", name: "Project Scope", scope: "project" },
          { id: "11", workspaceID: "w2", name: "Other Workspace" },
          { id: "folder-id", workspaceID: "w1", name: "Nonnumeric" },
          null,
          [],
        ],
      },
    ]);

    try {
      await expect(listFolders(TOKEN, " w1 ")).resolves.toEqual([
        { value: "007", label: "Alpha Folder" },
        { value: "0", label: "Zero Folder" },
        { value: "20", label: "Zulu Folder" },
      ]);
    } finally {
      socket.restore();
    }
  });

  test("normalizes array environments and orders draft then published labels deterministically", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "project.CRUD:REPLACE",
        rows: [
          {
            id: 200,
            workspaceID: 42,
            name: "Project",
            environments: [
              {
                name: "Beta",
                draftVersionID: "draft-beta",
                publishedVersionID: "published-beta",
              },
              "malformed",
              null,
              {
                title: "Alpha",
                draftVersionID: "draft-alpha",
                publishedVersionID: "published-alpha",
              },
              [],
            ],
          },
        ],
      },
    ]);

    try {
      await expect(listVersions(TOKEN, "42", "200")).resolves.toEqual([
        { value: "draft-alpha", label: "[Draft] Project — Alpha" },
        { value: "draft-beta", label: "[Draft] Project — Beta" },
        { value: "published-alpha", label: "[Published] Project — Alpha" },
        { value: "published-beta", label: "[Published] Project — Beta" },
      ]);
    } finally {
      socket.restore();
    }
  });

  test("normalizes map environments and uses environment label aliases", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "project.CRUD:REPLACE",
        rows: [
          {
            id: "project-map",
            workspaceID: "w1",
            title: "Map Project",
            environments: {
              production: {
                label: "Production",
                publishedVersionID: 302,
              },
              malformed: "omit",
              development: { id: "dev", draftVersionID: 301 },
              absent: null,
            },
          },
        ],
      },
    ]);

    try {
      await expect(
        listVersions(TOKEN, "w1", "project-map"),
      ).resolves.toEqual([
        { value: "301", label: "[Draft] Map Project — dev" },
        { value: "302", label: "[Published] Map Project — Production" },
      ]);
    } finally {
      socket.restore();
    }
  });

  test("returns no versions when the requested project is missing from its workspace", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "project.CRUD:REPLACE",
        rows: [
          {
            id: "other-project",
            workspaceID: "w1",
            environments: [{ draftVersionID: "other-version" }],
          },
          {
            id: "requested-project",
            workspaceID: "other-workspace",
            environments: [{ draftVersionID: "wrong-workspace-version" }],
          },
        ],
      },
    ]);

    try {
      await expect(
        listVersions(TOKEN, "w1", "requested-project"),
      ).resolves.toEqual([]);
    } finally {
      socket.restore();
    }
  });
});

describe("root dynamic selector Promise contracts", () => {
  test("returns Promise-shaped empty results without opening a socket when dependencies are blank", async () => {
    const previousWebSocket = globalThis.WebSocket;
    let constructorCalls = 0;
    class ForbiddenWebSocket {
      constructor() {
        constructorCalls += 1;
        throw new Error("blank selector dependencies must not open a WebSocket");
      }
    }
    globalThis.WebSocket = ForbiddenWebSocket as unknown as typeof WebSocket;

    try {
      const results = [
        sourceWorkspaceID(" "),
        sourceProjectID(TOKEN, " "),
        sourceVersionID(TOKEN, "w1", " "),
        destinationWorkspaceID("\t"),
        destinationFolderID(TOKEN, "\n"),
      ];
      for (const result of results) expectPromise(result);
      await expect(Promise.all(results)).resolves.toEqual([[], [], [], [], []]);
      expect(constructorCalls).toBe(0);
    } finally {
      globalThis.WebSocket = previousWebSocket;
    }
  });

  test("returns Promise-shaped catalog results for every populated selector", async () => {
    const socket = installCatalogWebSocket([
      {
        type: "workspace.CRUD:REPLACE",
        rows: [{ id: "w1", name: "Workspace" }],
      },
      {
        type: "project.CRUD:REPLACE",
        rows: [
          {
            id: "p1",
            workspaceID: "w1",
            name: "Project",
            environments: [
              { name: "Development", draftVersionID: "draft-1" },
            ],
          },
        ],
      },
      {
        type: "workspace-folder.REPLACE",
        rows: [{ id: "7", workspaceID: "w1", name: "Folder" }],
      },
    ]);

    try {
      const workspaceResult = sourceWorkspaceID(TOKEN);
      const projectResult = sourceProjectID(TOKEN, "w1");
      const versionResult = sourceVersionID(TOKEN, "w1", "p1");
      const destinationWorkspaceResult = destinationWorkspaceID(TOKEN);
      const folderResult = destinationFolderID(TOKEN, "w1");
      for (const result of [
        workspaceResult,
        projectResult,
        versionResult,
        destinationWorkspaceResult,
        folderResult,
      ]) {
        expectPromise(result);
      }

      await expect(workspaceResult).resolves.toEqual([
        { value: "w1", label: "Workspace" },
      ]);
      await expect(projectResult).resolves.toEqual([
        { value: "p1", label: "Project" },
      ]);
      await expect(versionResult).resolves.toEqual([
        { value: "draft-1", label: "[Draft] Project — Development" },
      ]);
      await expect(destinationWorkspaceResult).resolves.toEqual([
        { value: "w1", label: "Workspace" },
      ]);
      await expect(folderResult).resolves.toEqual([
        { value: "7", label: "Folder" },
      ]);
      expect(socket.urls).toHaveLength(5);
      expect(socket.closeCount()).toBe(5);
    } finally {
      socket.restore();
    }
  });
});
