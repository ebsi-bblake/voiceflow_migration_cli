import { expect, test } from "bun:test";
import { destinationFolderID, main } from "../migration_correct";

const token = "aaa.eyJzdWIiOiJjcmVhdG9yIn0.zzz";

test("rejects invalid folder IDs before fetch", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(); }) as typeof fetch;
  try {
    for (const value of ["", "project", 42, null]) {
      await expect(main(token, "w", "p", "v", "dw", value as never)).rejects.toThrow("numeric");
    }
    expect(calls).toBe(0);
  } finally { globalThis.fetch = previous; }
});

test("accepts a numeric folder at the first fetch boundary", async () => {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    urls.push(String(input));
    throw new Error("controlled boundary");
  }) as typeof fetch;
  try {
    await expect(main(token, "w", "p", "v", "dw", "0042")).rejects.toThrow("controlled boundary");
    expect(urls[0]).toContain("export-json");
  } finally { globalThis.fetch = previous; }
});

test("folder options retain numeric folders and omit projects/non-numeric values", async () => {
  const previous = globalThis.WebSocket;
  class Socket {
    static current: Socket;
    sentSync = false;
    onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
    onerror = () => {}; onclose = () => {};
    constructor() { Socket.current = this; queueMicrotask(() => this.onopen?.()); }
    send() { if (this.sentSync) return; this.sentSync = true; queueMicrotask(() => {
      this.onmessage?.({ data: JSON.stringify(["connected"]) });
      this.onmessage?.({ data: JSON.stringify(["sync", 1, { type: "workspace-folder.REPLACE", payload: { data: [
        { workspaceID: "workspace", id: "42", name: "Folder" },
        { workspaceID: "workspace", id: "project", name: "Project" },
        { workspaceID: "other", id: "99", name: "Other" },
      ] } }]) });
    }); }
    close() {}
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  try {
    await expect(destinationFolderID(token, "workspace")).resolves.toEqual([
      { value: "42", label: "Folder" },
    ]);
  } finally { globalThis.WebSocket = previous; }
});
