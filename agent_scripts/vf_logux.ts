import type { AuthContext } from "./vf_auth";
import { OperationFault } from "./vf_contracts";

type Row = Record<string, unknown>;
const URL = "wss://realtime.empyrean.voiceflow.com/";
const SUPPORTED_WANTED_TYPES = new Set([
  "workspace.CRUD:REPLACE",
  "project.CRUD:REPLACE",
  "workspace-folder.REPLACE",
]);
const MAX_INCOMING_FRAME_BYTES = 1_048_576;
const MAX_INCOMING_BYTES = 8_388_608;
const MAX_INCOMING_ROWS = 100_000;

function random8(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRowArray(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every((row) => isObject(row));
}
function sendFrame(ws: WebSocket, frame: unknown[]): void {
  ws.send(JSON.stringify(frame));
}

export function syncCatalog(
  auth: AuthContext,
  channel: string,
  wanted: string[],
): Promise<Row[]> {
  if (
    wanted.length === 0 ||
    wanted.some((type) => !SUPPORTED_WANTED_TYPES.has(type))
  ) {
    return Promise.reject(new OperationFault("INVALID_ARGUMENT"));
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const rows: Row[] = [];
    const wantedSet = new Set(wanted);
    const seen = new Set<string>();
    const requestID = Math.floor(Math.random() * 1_000_000_000) + 1;
    let done = false;
    let actionID = -1;
    let actionTime = 1;
    let incomingBytes = 0;
    let timer: ReturnType<typeof setTimeout>;
    const settle = (error?: OperationFault): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* settlement must not be interrupted */
      }
      try {
        if (error) reject(error);
        else resolve(rows);
      } finally {
        ws.onmessage = null;
      }
    };
    const safeSend = (frame: unknown[]): void => {
      try {
        sendFrame(ws, frame);
      } catch {
        settle(new OperationFault("DEPENDENCY_FAILURE", true));
      }
    };
    timer = setTimeout(
      () => settle(new OperationFault("DEPENDENCY_TIMEOUT", true)),
      15000,
    );
    ws.onerror = () => settle(new OperationFault("DEPENDENCY_FAILURE", true));
    ws.onclose = () => {
      if (!done) settle(new OperationFault("DEPENDENCY_FAILURE", true));
    };
    ws.onopen = () =>
      safeSend([
        "connect",
        4,
        `${auth.creatorID}:${random8()}:${random8()}`,
        0,
        { token: auth.token, subprotocol: "1.9.0" },
      ]);
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const frameBytes = new TextEncoder().encode(event.data).byteLength;
      incomingBytes += frameBytes;
      if (frameBytes > MAX_INCOMING_FRAME_BYTES || incomingBytes > MAX_INCOMING_BYTES) {
        settle(new OperationFault("DEPENDENCY_FAILURE"));
        return;
      }
      let frame: unknown;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      if (frame[0] === "error") {
        const code = frame[1] === "wrong-credentials"
          ? "AUTHENTICATION_FAILED"
          : "DEPENDENCY_FAILURE";
        settle(new OperationFault(code));
        return;
      }
      if (frame[0] === "connected") {
        safeSend([
          "sync",
          requestID,
          { channel, type: "logux/subscribe", since: { id: "0", time: 0 } },
          { id: actionID--, time: actionTime++ },
        ]);
        return;
      }
      const action = isObject(frame[2]) ? frame[2] : undefined;
      const payload =
        action && isObject(action.payload) ? action.payload : undefined;
      const type = action?.type;
      if (typeof type !== "string" || !wantedSet.has(type) || !payload) return;
      const values = payload.values ?? payload.data;
      if (!isRowArray(values)) return;
      if (rows.length + values.length > MAX_INCOMING_ROWS) {
        settle(new OperationFault("DEPENDENCY_FAILURE"));
        return;
      }
      seen.add(type);
      rows.push(...values);
      if ([...wantedSet].every((wantedType) => seen.has(wantedType))) settle();
    };
  });
}
