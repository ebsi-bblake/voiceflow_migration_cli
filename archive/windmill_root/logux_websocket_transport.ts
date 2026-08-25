import type { AuthContext } from "./jwt_authentication_context";
import { diagnostic } from "./migration_diagnostics";
const URL = "wss://realtime.empyrean.voiceflow.com/";
const MAX_INCOMING_MESSAGE_BYTES = 50_000_000;
const SUPPORTED_WANTED_ACTION_TYPES = new Set([
  "workspace.CRUD:REPLACE",
  "project.CRUD:REPLACE",
  "workspace-folder.REPLACE",
]);

type LoguxAction = Record<string, unknown>;

function isRecord(value: unknown): value is LoguxAction {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValidWantedActionTypes(wanted: string[]): boolean {
  return wanted.length > 0 && wanted.every((type) => SUPPORTED_WANTED_ACTION_TYPES.has(type));
}

function extractCatalogValues(
  frame: unknown,
  wanted: string[],
): { type: string; values: unknown[] } | undefined {
  if (!Array.isArray(frame) || !isRecord(frame[2])) return undefined;

  const action = frame[2];
  const type = typeof action.type === "string" ? action.type : undefined;
  if (!type || !wanted.includes(type) || !isRecord(action.payload)) return undefined;

  const values = type === "workspace.CRUD:REPLACE" || type === "project.CRUD:REPLACE"
    ? action.payload.values
    : type === "workspace-folder.REPLACE"
      ? action.payload.data
      : undefined;
  return Array.isArray(values) ? { type, values } : undefined;
}

function appendValidObjectRows(rows: Record<string, unknown>[], values: unknown[]): void {
  rows.push(...values.filter(isRecord));
}

export function sync(
  auth: AuthContext,
  channel: string,
  wanted: string[],
): Promise<Record<string, unknown>[]> {
  if (!hasValidWantedActionTypes(wanted)) {
    return Promise.reject(diagnostic("Catalog", "invalid-input", { endpoint: "catalog" }));
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL),
      rows: Record<string, unknown>[] = [],
      types = new Set<string>();
    let done = false,
      action = -1,
      incomingMessageBytes = 0;
    const timer = setTimeout(
      () => finish(diagnostic("Catalog", "timeout", { endpoint: "catalog" })),
      15_000,
    );
    const finish = (e?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      e ? reject(e) : resolve(rows);
    };
    const sendFrame = (frame: unknown[]): void => {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        finish(diagnostic("Catalog", "network-error", { endpoint: "catalog" }));
      }
    };
    ws.onerror = () => finish(diagnostic("Catalog", "network-error", { endpoint: "catalog" }));
    ws.onclose = () => {
      if (!done) finish(diagnostic("Catalog", "network-error", { endpoint: "catalog" }));
    };
    ws.onopen = () =>
      sendFrame([
        "connect",
        4,
        `${auth.creatorID}:${crypto.randomUUID().slice(0, 8)}`,
        0,
        { token: auth.token, subprotocol: "1.9.0" },
      ]);
    ws.onmessage = (e) => {
      const text = String(e.data);
      if (text.length > 2_000_000)
        return finish(diagnostic("Catalog", "response-too-large", { endpoint: "catalog", responseSize: text.length }));
      incomingMessageBytes += new TextEncoder().encode(text).byteLength;
      if (incomingMessageBytes > MAX_INCOMING_MESSAGE_BYTES)
        return finish(diagnostic("Catalog", "response-too-large", { endpoint: "catalog", responseSize: incomingMessageBytes }));
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      switch (frame[0]) {
        case "error":
          return finish(diagnostic("Catalog", "server-error", { endpoint: "catalog" }));
        case "connected":
          sendFrame([
            "sync",
            Date.now(),
            { channel, type: "logux/subscribe", since: { id: "0", time: 0 } },
            { id: action--, time: 1 },
          ]);
          break;
        case "sync": {
          const catalog = extractCatalogValues(frame, wanted);
          if (catalog) {
            appendValidObjectRows(rows, catalog.values);
            types.add(catalog.type);
          }
          if (wanted.every((x) => types.has(x))) finish();
          break;
        }
      }
    };
  });
}
