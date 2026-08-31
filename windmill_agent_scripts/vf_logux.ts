import type { AuthContext } from "./vf_auth";
import { OperationFault } from "./vf_contracts";

type Row = Record<string, unknown>;
type Settle = (error?: OperationFault) => void;
type SocketContext = {
  readonly auth: AuthContext;
  readonly channel: string;
  readonly wanted: ReadonlySet<string>;
  readonly requestID: number;
  readonly rows: Row[];
  readonly seen: Set<string>;
  readonly settle: Settle;
  readonly safeSend: (frame: unknown[]) => void;
  actionID: number;
  actionTime: number;
  incomingBytes: number;
  timer?: ReturnType<typeof setTimeout>;
};

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

function isNonNullObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (!isNonNullObject(value)) return false;
  return !Array.isArray(value);
}

function isRowArray(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every(isObject);
}

function isSupportedRequest(wanted: readonly string[]): boolean {
  return wanted.length > 0 && wanted.every((type) => SUPPORTED_WANTED_TYPES.has(type));
}

function sendFrame(ws: WebSocket, frame: unknown[]): void {
  ws.send(JSON.stringify(frame));
}

function closeSocket(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    // Settlement must not be interrupted by socket cleanup.
  }
}

function settlePromise(
  error: OperationFault | undefined,
  rows: Row[],
  resolve: (rows: Row[]) => void,
  reject: (error: OperationFault) => void,
): void {
  if (error) reject(error);
  else resolve(rows);
}

function settleSocket(
  ws: WebSocket,
  context: SocketContext,
  error: OperationFault | undefined,
  resolve: (rows: Row[]) => void,
  reject: (error: OperationFault) => void,
): void {
  if (context.timer !== undefined) {
    clearTimeout(context.timer);
    context.timer = undefined;
  }
  closeSocket(ws);
  settlePromise(error, context.rows, resolve, reject);
  ws.onmessage = null;
}

function createContext(
  auth: AuthContext,
  channel: string,
  wanted: readonly string[],
  ws: WebSocket,
  resolve: (rows: Row[]) => void,
  reject: (error: OperationFault) => void,
): SocketContext {
  let done = false;
  let context: SocketContext;
  const settle: Settle = (error) => {
    if (done) return;
    done = true;
    settleSocket(ws, context, error, resolve, reject);
  };
  const safeSend = (frame: unknown[]): void => {
    try {
      sendFrame(ws, frame);
    } catch {
      settle(new OperationFault("DEPENDENCY_FAILURE", true));
    }
  };
  context = {
    auth,
    channel,
    wanted: new Set(wanted),
    requestID: Math.floor(Math.random() * 1_000_000_000) + 1,
    rows: [],
    seen: new Set<string>(),
    settle,
    safeSend,
    actionID: -1,
    actionTime: 1,
    incomingBytes: 0,
  };
  context.timer = setTimeout(
    () => context.settle(new OperationFault("DEPENDENCY_TIMEOUT", true)),
    15000,
  );
  return context;
}

function connectFrame(context: SocketContext): unknown[] {
  return [
    "connect",
    4,
    `${context.auth.creatorID}:${random8()}:${random8()}`,
    0,
    { token: context.auth.token, subprotocol: "1.9.0" },
  ];
}

function subscribeFrame(context: SocketContext): unknown[] {
  return [
    "sync",
    context.requestID,
    { channel: context.channel, type: "logux/subscribe", since: { id: "0", time: 0 } },
    { id: context.actionID--, time: context.actionTime++ },
  ];
}

function asFrame(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function parseFrame(data: string): readonly unknown[] | undefined {
  try {
    return asFrame(JSON.parse(data));
  } catch {
    return undefined;
  }
}

function frameExceedsLimits(
  frameBytes: number,
  incomingBytes: number,
): boolean {
  return frameBytes > MAX_INCOMING_FRAME_BYTES || incomingBytes > MAX_INCOMING_BYTES;
}

function handleErrorFrame(frame: readonly unknown[], settle: Settle): void {
  const code = frame[1] === "wrong-credentials"
    ? "AUTHENTICATION_FAILED"
    : "DEPENDENCY_FAILURE";
  settle(new OperationFault(code));
}

function readAction(frame: readonly unknown[]): Record<string, unknown> | undefined {
  return isObject(frame[2]) ? frame[2] : undefined;
}

function objectPayload(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function readActionPayload(
  action: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (action === undefined) return undefined;
  return objectPayload(action.payload);
}

function isWantedAction(
  type: unknown,
  wanted: ReadonlySet<string>,
): type is string {
  return typeof type === "string" && wanted.has(type);
}

// Action frames combine protocol parsing and catalog filtering at one boundary.
// oxlint-disable-next-line complexity
function handleActionFrame(frame: readonly unknown[], context: SocketContext): void {
  const action = readAction(frame);
  const payload = readActionPayload(action);
  const type = action?.type;
  if (!isWantedAction(type, context.wanted) || payload === undefined) return;
  appendAction(type, payload, context);
}

function readActionValues(payload: Record<string, unknown>): unknown {
  return payload.values ?? payload.data;
}

function appendRows(
  type: string,
  values: Row[],
  context: SocketContext,
): void {
  if (rowsExceedLimit(context.rows, values)) {
    context.settle(new OperationFault("DEPENDENCY_FAILURE"));
    return;
  }
  context.seen.add(type);
  context.rows.push(...values);
  settleWhenCatalogComplete(context);
}

function settleWhenCatalogComplete(context: SocketContext): void {
  if (hasSeenAllWantedTypes(context.wanted, context.seen)) context.settle();
}

function appendAction(
  type: string,
  payload: Record<string, unknown>,
  context: SocketContext,
): void {
  const values = readActionValues(payload);
  if (!isRowArray(values)) return;
  appendRows(type, values, context);
}

function rowsExceedLimit(rows: readonly Row[], values: readonly Row[]): boolean {
  return rows.length + values.length > MAX_INCOMING_ROWS;
}

function hasSeenAllWantedTypes(
  wanted: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): boolean {
  return [...wanted].every((type) => seen.has(type));
}

function handleFrame(frame: readonly unknown[], context: SocketContext): void {
  if (frame[0] === "error") return handleErrorFrame(frame, context.settle);
  return handleProtocolFrame(frame, context);
}

function handleProtocolFrame(
  frame: readonly unknown[],
  context: SocketContext,
): void {
  if (frame[0] === "connected") return context.safeSend(subscribeFrame(context));
  handleActionFrame(frame, context);
}

function handleTextMessage(data: string, context: SocketContext): void {
  const frameBytes = new TextEncoder().encode(data).byteLength;
  const incomingBytes = context.incomingBytes + frameBytes;
  context.incomingBytes = incomingBytes;
  if (frameExceedsLimits(frameBytes, incomingBytes)) {
    context.settle(new OperationFault("DEPENDENCY_FAILURE"));
    return;
  }
  dispatchParsedFrame(parseFrame(data), context);
}

function dispatchParsedFrame(
  frame: readonly unknown[] | undefined,
  context: SocketContext,
): void {
  if (frame !== undefined) handleFrame(frame, context);
}

function handleMessage(event: MessageEvent, context: SocketContext): void {
  if (typeof event.data !== "string") return;
  handleTextMessage(event.data, context);
}

function configureSocket(
  ws: WebSocket,
  context: SocketContext,
): void {
  ws.onerror = () => context.settle(new OperationFault("DEPENDENCY_FAILURE", true));
  ws.onclose = () => context.settle(new OperationFault("DEPENDENCY_FAILURE", true));
  ws.onopen = () => context.safeSend(connectFrame(context));
  ws.onmessage = (event) => handleMessage(event, context);
}

export function syncCatalog(
  auth: AuthContext,
  channel: string,
  wanted: string[],
): Promise<Row[]> {
  if (!isSupportedRequest(wanted))
    return Promise.reject(new OperationFault("INVALID_ARGUMENT"));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const context = createContext(auth, channel, wanted, ws, resolve, reject);
    configureSocket(ws, context);
  });
}
