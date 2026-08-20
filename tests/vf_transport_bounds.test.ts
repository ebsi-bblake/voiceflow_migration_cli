import { expect, test } from "bun:test";

import { syncCatalog } from "../agent_scripts/vf_logux";
import {
  main as migrateOneFile,
  sourceWorkspaceID as listOneFileWorkspaces,
} from "../migration_correct";

const TOKEN = "aaa.eyJzdWIiOiJjcmVhdG9yIn0.zzz";
const MIGRATION_ARGUMENTS = [
  TOKEN,
  "workspace",
  "project",
  "version",
  "destination",
  "folder",
] as const;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type ControlledTimers = {
  delays: readonly number[];
  fireNext: () => void;
  pendingCount: () => number;
  restore: () => void;
};

function installControlledTimers(): ControlledTimers {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  let nextID = 1;

  globalThis.setTimeout = ((
    handler: (...arguments_: unknown[]) => void,
    delay?: number,
    ...arguments_: unknown[]
  ) => {
    const id = nextID++;
    delays.push(Number(delay ?? 0));
    callbacks.set(id, () => handler(...arguments_));
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    callbacks.delete(id as unknown as number);
  }) as typeof clearTimeout;

  return {
    delays,
    fireNext: () => {
      const next = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!next) throw new Error("No controlled timeout is pending");
      callbacks.delete(next[0]);
      next[1]();
    },
    pendingCount: () => callbacks.size,
    restore: () => {
      callbacks.clear();
      globalThis.setTimeout = previousSetTimeout;
      globalThis.clearTimeout = previousClearTimeout;
    },
  };
}

type ControlledBodyObservation = {
  readCalls: number;
  readerCancelCalls: number;
  bodyCancelCalls: number;
  releaseLockCalls: number;
};

function createControlledBodyResponse(options: {
  headers?: HeadersInit;
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  status?: number;
}): { response: Response; observation: ControlledBodyObservation } {
  const observation: ControlledBodyObservation = {
    readCalls: 0,
    readerCancelCalls: 0,
    bodyCancelCalls: 0,
    releaseLockCalls: 0,
  };
  const reader = {
    read: async () => {
      observation.readCalls += 1;
      return options.read();
    },
    cancel: async () => {
      observation.readerCancelCalls += 1;
    },
    releaseLock: () => {
      observation.releaseLockCalls += 1;
    },
  };
  const body = {
    getReader: () => reader,
    cancel: async () => {
      observation.bodyCancelCalls += 1;
    },
  };
  const status = options.status ?? 200;
  const response = {
    body,
    headers: new Headers(options.headers),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
  return { response, observation };
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function buildLoguxValuesFrame(type: string, rowCount: number): string {
  const values = Array.from({ length: rowCount }, () => ({}));
  return JSON.stringify(["sync", 1, { type, payload: { values } }]);
}

function buildIgnoredLoguxValuesFrame(rowCount: number): string {
  const values = Array.from({ length: rowCount }, () => null);
  return JSON.stringify([
    "sync",
    1,
    { type: "ignored", payload: { values } },
  ]);
}

class FakeSocket {
  static last: FakeSocket;
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor() {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.());
  }

  send(_frame: string): void {}

  close(): void {
    this.closeCalls += 1;
    this.onclose?.();
  }
}

class ThrowingSendSocket {
  static last: ThrowingSendSocket;
  closeCalls = 0;
  sendCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor() {
    ThrowingSendSocket.last = this;
  }

  send(_frame: string): void {
    this.sendCalls += 1;
    throw new Error("controlled WebSocket send failure");
  }

  close(): void {
    this.closeCalls += 1;
    this.onclose?.();
  }
}

test("rejects an oversized UTF-8 Logux frame", async () => {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  try {
    const result = syncCatalog(
      { creatorID: "creator", token: "token" },
      "creator/creator",
      ["workspace.CRUD:REPLACE"],
    );
    await new Promise<void>((resolve) => queueMicrotask(() => {
      FakeSocket.last.onmessage?.({ data: `😀${"x".repeat(1_048_576)}` });
      resolve();
    }));
    await expect(result).rejects.toMatchObject({ code: "DEPENDENCY_FAILURE" });
  } finally {
    globalThis.WebSocket = previous;
  }
});

test("bounds import response streams and aborts the request", async () => {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  let importSignal: AbortSignal | undefined;
  let cancelled = false;
  const oversizedChunk = new Uint8Array(1_500_000);
  const importStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oversizedChunk);
      controller.enqueue(oversizedChunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("export-json")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    importSignal = init?.signal;
    return new Response(importStream, { status: 200 });
  }) as typeof fetch;
  try {
    await expect(migrateOneFile(...MIGRATION_ARGUMENTS)).rejects.toThrow(
      "HTTP response exceeded the allowed size",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("export-json");
    expect(calls[1]).toContain("import-file");
    expect(cancelled).toBe(true);
    expect(importSignal?.aborted).toBe(true);
  } finally {
    globalThis.fetch = previous;
  }
});

test("times out one-file migration while export headers are stalled", async () => {
  const previousFetch = globalThis.fetch;
  const timers = installControlledTimers();
  let observedSignal: AbortSignal | undefined;
  let abortEvents = 0;
  let fetchCalls = 0;

  globalThis.fetch = ((input, init) => {
    fetchCalls += 1;
    observedSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (!observedSignal) {
        reject(new Error(`Missing abort signal for ${String(input)}`));
        return;
      }
      observedSignal.addEventListener(
        "abort",
        () => {
          abortEvents += 1;
          reject(abortError());
        },
        { once: true },
      );
    });
  }) as typeof fetch;

  try {
    const result = migrateOneFile(...MIGRATION_ARGUMENTS);
    expect(fetchCalls).toBe(1);
    expect(timers.delays).toEqual([30_000]);

    timers.fireNext();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal?.aborted).toBe(true);
    expect(abortEvents).toBe(1);
    expect(timers.pendingCount()).toBe(0);
  } finally {
    globalThis.fetch = previousFetch;
    timers.restore();
  }
});

test("times out one-file migration while the export body read is stalled", async () => {
  const previousFetch = globalThis.fetch;
  const timers = installControlledTimers();
  const readStarted = createDeferred<void>();
  const stalledRead = createDeferred<ReadableStreamReadResult<Uint8Array>>();
  const controlled = createControlledBodyResponse({
    read: () => {
      readStarted.resolve();
      return stalledRead.promise;
    },
  });
  let observedSignal: AbortSignal | undefined;
  let abortEvents = 0;

  globalThis.fetch = ((_input, init) => {
    observedSignal = init?.signal;
    if (!observedSignal) return Promise.reject(new Error("Missing abort signal"));
    observedSignal.addEventListener(
      "abort",
      () => {
        abortEvents += 1;
        stalledRead.reject(abortError());
      },
      { once: true },
    );
    return Promise.resolve(controlled.response);
  }) as typeof fetch;

  try {
    const result = migrateOneFile(...MIGRATION_ARGUMENTS);
    await readStarted.promise;
    expect(timers.delays).toEqual([30_000]);

    timers.fireNext();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal?.aborted).toBe(true);
    expect(abortEvents).toBe(1);
    expect(controlled.observation.readCalls).toBe(1);
    expect(controlled.observation.readerCancelCalls).toBe(1);
    expect(controlled.observation.releaseLockCalls).toBe(1);
    expect(timers.pendingCount()).toBe(0);
  } finally {
    stalledRead.promise.catch(() => undefined);
    globalThis.fetch = previousFetch;
    timers.restore();
  }
});

test("rejects an oversized declared export before reading its body", async () => {
  const previousFetch = globalThis.fetch;
  const controlled = createControlledBodyResponse({
    headers: { "content-length": "50000001" },
    read: async () => {
      throw new Error(
        "Export response body was read despite oversized Content-Length",
      );
    },
  });

  globalThis.fetch = (async (input) => {
    if (!String(input).includes("export-json")) {
      throw new Error("Unexpected request after oversized export");
    }
    return controlled.response;
  }) as typeof fetch;

  try {
    await expect(migrateOneFile(...MIGRATION_ARGUMENTS)).rejects.toThrow(
      "HTTP response exceeded the allowed size",
    );
    expect(controlled.observation.readCalls).toBe(0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("applies the API-key response limit before reading its body", async () => {
  const previousFetch = globalThis.fetch;
  const apiKeyResponse = createControlledBodyResponse({
    headers: { "content-length": "1048577" },
    read: async () => {
      throw new Error(
        "API-key response body was read despite oversized Content-Length",
      );
    },
  });
  const calls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("export-json")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    if (url.includes("import-file")) {
      return new Response(JSON.stringify({ project: { _id: "imported-project" } }), {
        status: 200,
      });
    }
    return apiKeyResponse.response;
  }) as typeof fetch;

  try {
    const result = await migrateOneFile(...MIGRATION_ARGUMENTS);

    expect(calls).toHaveLength(3);
    expect(result).toMatchObject({
      apiKeyRetrieved: false,
      postImport: {
        apiKeyRetrieved: false,
        diagnostic: { code: "api-key-retrieval-failed" },
      },
    });
    expect(apiKeyResponse.observation.readCalls).toBe(0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("strictly rejects malformed one-file import JSON", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("export-json")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    if (url.includes("import-file")) {
      return new Response("{malformed", { status: 200 });
    }
    throw new Error("API-key retrieval must not follow malformed import JSON");
  }) as typeof fetch;

  try {
    await expect(migrateOneFile(...MIGRATION_ARGUMENTS)).rejects.toThrow(
      "Import response was not valid JSON",
    );
    expect(calls).toHaveLength(2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("closes the one-file WebSocket exactly once on an oversized frame", async () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

  try {
    const result = listOneFileWorkspaces(TOKEN);
    await Promise.resolve();
    const socket = FakeSocket.last;

    socket.onmessage?.({ data: "x".repeat(2_000_001) });
    socket.onerror?.();

    await expect(result).rejects.toThrow(
      "Logux response exceeded the allowed size",
    );
    expect(socket.closeCalls).toBe(1);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("rejects one-file Logux rows accumulated across frames", async () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

  try {
    const result = listOneFileWorkspaces(TOKEN);
    await Promise.resolve();
    const socket = FakeSocket.last;

    socket.onmessage?.({ data: buildIgnoredLoguxValuesFrame(50_001) });
    socket.onmessage?.({ data: buildIgnoredLoguxValuesFrame(50_000) });

    await expect(result).rejects.toThrow(
      "Logux response exceeded the allowed row count",
    );
    expect(socket.closeCalls).toBe(1);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("marks split Logux row-limit failures as non-retryable", async () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

  try {
    const result = syncCatalog(
      { creatorID: "creator", token: "token" },
      "creator/creator",
      ["workspace.CRUD:REPLACE"],
    );
    await Promise.resolve();

    FakeSocket.last.onmessage?.({
      data: buildLoguxValuesFrame("workspace.CRUD:REPLACE", 100_001),
    });

    await expect(result).rejects.toMatchObject({
      code: "DEPENDENCY_FAILURE",
      retryable: false,
    });
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("marks split Logux send failures as retryable and cleans up", async () => {
  const previousWebSocket = globalThis.WebSocket;
  const timers = installControlledTimers();
  globalThis.WebSocket = ThrowingSendSocket as unknown as typeof WebSocket;

  try {
    const result = syncCatalog(
      { creatorID: "creator", token: "token" },
      "creator/creator",
      ["workspace.CRUD:REPLACE"],
    );
    const socket = ThrowingSendSocket.last;

    expect(timers.pendingCount()).toBe(1);
    socket.onopen?.();

    expect(socket.sendCalls).toBe(1);
    const failure = await result.then(
      () => new Error("Expected syncCatalog to reject"),
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: "DEPENDENCY_FAILURE",
      retryable: true,
    });
    expect(socket.closeCalls).toBe(1);
    expect(socket.onmessage).toBeNull();
    expect(timers.pendingCount()).toBe(0);

    socket.onerror?.();
    expect(socket.closeCalls).toBe(1);
  } finally {
    globalThis.WebSocket = previousWebSocket;
    timers.restore();
  }
});
