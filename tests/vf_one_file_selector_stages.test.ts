import { expect, test } from "bun:test";
import {
  destinationFolderID,
  sourceProjectID,
  sourceVersionID,
  sourceWorkspaceID,
} from "../migration_correct";

const token = "aaa.eyJzdWIiOiJjcmVhdG9yIn0.zzz";

function installSocket(payload: unknown[], type = "workspace.CRUD:REPLACE") {
  const previous = globalThis.WebSocket;
  class FakeSocket {
    responded = false;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror = () => {};
    onclose = () => {};
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send() {
      if (this.responded) return;
      this.responded = true;
      queueMicrotask(() => {
        this.onmessage?.({ data: JSON.stringify(["connected"]) });
        this.onmessage?.({ data: JSON.stringify(["sync", 1, {
          type,
          payload: type === "workspace-folder.REPLACE"
            ? { data: payload }
            : { values: payload },
        }]) });
      });
    }
    close() {}
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  return () => { globalThis.WebSocket = previous; };
}

test("projects workspace and project records without changing order or omission", async () => {
  const restore = installSocket([
    { id: "w1", name: "Workspace" },
    { id: 0, name: "Omitted" },
    { id: "w2", title: "Second" },
  ]);
  try { await expect(sourceWorkspaceID(token)).resolves.toEqual([
    { value: "w1", label: "Workspace" },
    { value: "w2", label: "Second" },
  ]); } finally { restore(); }

  const restoreProjects = installSocket([
    { id: "p1", workspaceID: "w1", name: "First" },
    { id: "other", workspaceID: "w2", name: "Other" },
    { id: "p2", workspaceID: "w1", title: "Second" },
  ], "project.CRUD:REPLACE");
  try { await expect(sourceProjectID(token, "w1")).resolves.toEqual([
    { value: "p1", label: "First" },
    { value: "p2", label: "Second" },
  ]); } finally { restoreProjects(); }
});

test("selector validation rejects invalid tokens asynchronously", async () => {
  const results = [
    sourceWorkspaceID("not-a-jwt"),
    sourceProjectID("not-a-jwt", "w1"),
    sourceVersionID("not-a-jwt", "w1", "p1"),
    destinationFolderID("not-a-jwt", "w1"),
  ];
  for (const result of results) {
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow("Authentication token must be a JWT");
  }
});

test("rejects array JWT claims before constructing a WebSocket", async () => {
  const previousWebSocket = globalThis.WebSocket;
  let constructorCalls = 0;
  class ForbiddenWebSocket {
    constructor() {
      constructorCalls += 1;
    }
  }
  globalThis.WebSocket = ForbiddenWebSocket as unknown as typeof WebSocket;

  try {
    const result = sourceWorkspaceID("aaa.W10.zzz");
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow("JWT claims must be an object");
    expect(constructorCalls).toBe(0);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("missing projects produce no version options", async () => {
  const restore = installSocket([
    { id: "other", workspaceID: "w1", name: "Other" },
  ], "project.CRUD:REPLACE");
  try {
    await expect(sourceVersionID(token, "w1", "missing")).resolves.toEqual([]);
  } finally { restore(); }
});

test("projects draft and published versions from array and map environments", async () => {
  const restore = installSocket([{ id: "p1", workspaceID: "w1", name: "Project", environments: {
    first: { id: "dev", draftVersionID: "d1", publishedVersionID: "pub1" },
    second: { label: "Production", publishedVersionID: "pub2" },
  } }], "project.CRUD:REPLACE");
  try { await expect(sourceVersionID(token, "w1", "p1")).resolves.toEqual([
    { value: "d1", label: "[Draft] Project — dev" },
    { value: "pub1", label: "[Published] Project — dev" },
    { value: "pub2", label: "[Published] Project — Production" },
  ]); } finally { restore(); }
});

test("destination folders preserve order and omit non-numeric IDs", async () => {
  const restore = installSocket([
    { id: "12", workspaceID: "w1", name: "Second" },
    { id: "not-numeric", workspaceID: "w1", name: "Omitted" },
    { id: "3", workspaceID: "w1", title: "First" },
    { id: "99", workspaceID: "w2", name: "Other workspace" },
  ], "workspace-folder.REPLACE");
  try {
    await expect(destinationFolderID(token, "w1")).resolves.toEqual([
      { value: "12", label: "Second" },
      { value: "3", label: "First" },
    ]);
  } finally { restore(); }
});
