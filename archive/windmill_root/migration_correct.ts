// Windmill setup: add this script to a Bun runtime and mark token as a secret.
// The five DynSelect_* exports are the dynamic-select input types used by Windmill.

export type DynSelect_sourceWorkspaceID = string;
export type DynSelect_sourceProjectID = string;
export type DynSelect_sourceVersionID = string;
export type DynSelect_destinationWorkspaceID = string;
export type DynSelect_destinationFolderID = string;

type Option = { value: string; label: string };
type RawRecord = Record<string, unknown>;
type LoguxFrame = readonly unknown[];

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is RawRecord[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
type PostImportDiagnostic = {
  readonly code: string;
  readonly message: string;
};
type ApiKeyOutcome =
  | {
      readonly apiKeyRetrieved: true;
      readonly postImport?: never;
    }
  | {
      readonly apiKeyRetrieved: false;
      readonly postImport: {
        readonly apiKeyRetrieved: false;
        readonly diagnostic: PostImportDiagnostic;
      };
    };

const REALTIME = "wss://realtime.empyrean.voiceflow.com/";
const MAX_EXPORT_BYTES = 50_000_000;
const MAX_IMPORT_BYTES = 2_097_152;
const MAX_API_KEY_BYTES = 1_048_576;
const MAX_LOGUX_FRAME_BYTES = 2_000_000;
const MAX_LOGUX_BYTES = 50_000_000;
const MAX_LOGUX_ROWS = 100_000;
const PROJECT_ID_UNAVAILABLE: PostImportDiagnostic = {
  code: "project-id-unavailable",
  message: "Import succeeded, but the imported project ID was unavailable.",
};
const API_KEY_RETRIEVAL_FAILED: PostImportDiagnostic = {
  code: "api-key-retrieval-failed",
  message: "Import succeeded, but the project API key could not be retrieved.",
};

function successfulApiKeyOutcome(): ApiKeyOutcome {
  return { apiKeyRetrieved: true };
}

function failedApiKeyOutcome(diagnostic: PostImportDiagnostic): ApiKeyOutcome {
  return {
    apiKeyRetrieved: false,
    postImport: {
      apiKeyRetrieved: false,
      diagnostic,
    },
  };
}

function missingProjectApiKeyOutcome(): ApiKeyOutcome {
  return failedApiKeyOutcome(PROJECT_ID_UNAVAILABLE);
}

function failedApiKeyRetrievalOutcome(): ApiKeyOutcome {
  return failedApiKeyOutcome(API_KEY_RETRIEVAL_FAILED);
}

function normalizeToken(input: unknown): string {
  if (typeof input !== "string")
    throw new Error("Authentication token must be a string");
  const token = input
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) throw new Error("Authentication token is empty");
  if (token.split(".").length !== 3)
    throw new Error("Authentication token must be a JWT");
  return token;
}

function extractImportedProjectID(input: unknown): string | undefined {
  if (typeof input === "string" || typeof input === "number") {
    const value = String(input).trim();
    return value || undefined;
  }
  if (!isRecord(input)) return undefined;
  const record = input;
  const project = record.project;
  if (isRecord(project)) {
    const projectID = project._id;
    if (typeof projectID === "string" || typeof projectID === "number") {
      const value = String(projectID).trim();
      if (value) return value;
    }
  }
  for (const key of ["projectID", "projectId", "_id", "id"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function collectApiKeyCandidates(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const record = input;
  return ["apiKey", "api_key", "key", "token"]
    .map((field) => record[field])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => /^VF\.DM\..+/.test(value));
}

function validateDestinationFolderID(input: unknown): string | undefined {
  if (typeof input !== "string" || !/^\d+$/.test(input.trim())) return undefined;
  return input.trim();
}

function selectRowsForWorkspace(rows: readonly RawRecord[], workspaceID: string): RawRecord[] {
  return rows.filter((row) => String(row.workspaceID) === workspaceID);
}

function selectNumericDestinationFolders(rows: readonly RawRecord[]): Array<RawRecord & { id: string }> {
  return rows.flatMap((row) => {
    const id = validateDestinationFolderID(row.id);
    return id ? [{ ...row, id }] : [];
  });
}

function projectFolderOptions(rows: Array<RawRecord & { id: string }>): Option[] {
  return rows.map((row) => ({
    value: row.id,
    label: String(row.name ?? row.title ?? row.id),
  }));
}

function normalizeRawID(value: unknown): string | undefined {
  return value ? String(value) : undefined;
}

function normalizeRawLabel(record: RawRecord): string {
  return String(record.name ?? record.title ?? record.id);
}

function selectRecordsByWorkspace(rows: readonly RawRecord[], workspaceID: string): RawRecord[] {
  return rows.filter((row) => String(row.workspaceID) === workspaceID);
}

function selectProjectByWorkspaceAndID(
  rows: readonly RawRecord[],
  workspaceID: string,
  projectID: string,
): RawRecord | undefined {
  return selectRecordsByWorkspace(rows, workspaceID).find(
    (row) => String(row.id) === projectID,
  );
}

function projectWorkspaceOptions(rows: readonly RawRecord[]): Option[] {
  return rows.flatMap((row) => {
    const value = normalizeRawID(row.id);
    return value ? [{ value, label: normalizeRawLabel(row) }] : [];
  });
}

function projectProjectOptions(rows: readonly RawRecord[], workspaceID: string): Option[] {
  return projectWorkspaceOptions(selectRecordsByWorkspace(rows, workspaceID));
}

export const workspaceOptions = (rows: readonly RawRecord[]): Option[] =>
  projectWorkspaceOptions(rows);

export const projectOptions = (workspaceID: string) => (rows: readonly RawRecord[]): Option[] =>
  projectProjectOptions(rows, workspaceID);

function normalizeArrayMapEnvironments(value: unknown): RawRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  return Object.values(value).filter(isRecord);
}

function buildVersionOptions(
  project: RawRecord | undefined,
  projectID: string,
): Option[] {
  if (!project) return [];
  const projectLabel = String(project.name ?? project.title ?? projectID);
  return normalizeArrayMapEnvironments(project.environments).flatMap((environment) => {
    const name = String(environment.name ?? environment.label ?? environment.id ?? "Environment");
    const options: Option[] = [];
    const draftID = normalizeRawID(environment.draftVersionID);
    const publishedID = normalizeRawID(environment.publishedVersionID);
    if (draftID) options.push({ value: draftID, label: `[Draft] ${projectLabel} — ${name}` });
    if (publishedID) options.push({ value: publishedID, label: `[Published] ${projectLabel} — ${name}` });
    return options;
  });
}

export const versionOptions = (workspaceID: string, projectID: string) =>
  (rows: readonly RawRecord[]): Option[] =>
    buildVersionOptions(
      selectProjectByWorkspaceAndID(rows, workspaceID, projectID),
      projectID,
    );

export const folderOptions = (workspaceID: string) => (rows: readonly RawRecord[]): Option[] =>
  projectFolderOptions(
    selectNumericDestinationFolders(selectRowsForWorkspace(rows, workspaceID)),
  );

async function readBoundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error("HTTP response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("HTTP response exceeded the allowed size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function parseResponseBytes(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseImportResponse(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) throw new Error("Import response was empty");
  try { return JSON.parse(text); } catch { throw new Error("Import response was not valid JSON"); }
}

async function fetchBoundedResponse(input: RequestInfo | URL, init: RequestInit, limit: number, deadlineMs: number): Promise<{ response: Response; bytes: Uint8Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > limit)
      throw new Error("HTTP response exceeded the allowed size");
    return { response, bytes: await readBoundedBytes(response, limit) };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function retrieveProjectApiKey(
  projectID: string,
  token: string,
): Promise<string> {
  const { response, bytes } = await fetchBoundedResponse(
    `https://identity-api.empyrean.voiceflow.com/v1alpha1/api-key/legacy/project/${encodeURIComponent(projectID)}`,
    { method: "POST", headers: { Authorization: `Bearer ${normalizeToken(token)}` } }, MAX_API_KEY_BYTES, 30_000,
  );
  if (!response.ok) throw new Error("Project API-key retrieval failed");
  const payload = parseResponseBytes(bytes);
  const candidates = [...new Set(collectApiKeyCandidates(payload))];
  if (candidates.length === 0) throw new Error("Project API-key was not returned");
  if (candidates.length > 1) throw new Error("Multiple project API-keys were returned");
  return candidates[0];
}

async function retrievePostImportApiKeyOutcome(
  projectID: string | undefined,
  token: string,
): Promise<ApiKeyOutcome> {
  if (!projectID) {
    return missingProjectApiKeyOutcome();
  }
  try {
    await retrieveProjectApiKey(projectID, token);
    return successfulApiKeyOutcome();
  } catch {
    return failedApiKeyRetrievalOutcome();
  }
}

function jwtClaims(token: string): RawRecord {
  const part = token.split(".")[1];
  if (!part) throw new Error("JWT has no claims");
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const claims: unknown = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
        (c) => c.charCodeAt(0),
      ),
    ),
  );
  if (!isRecord(claims)) throw new Error("JWT claims must be an object");
  return claims;
}

function creatorID(token: string): string {
  const claims = jwtClaims(normalizeToken(token));
  const id = claims.creatorID ?? claims.userID ?? claims.user_id ?? claims.sub;
  if (!id) throw new Error("JWT does not contain a creator/user ID");
  return String(id);
}

function random8(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function sync(
  token: string,
  channels: string[],
  wanted: string[],
): Promise<readonly RawRecord[]> {
  return new Promise((resolve, reject) => {
    const authToken = normalizeToken(token);
    const ws = new WebSocket(REALTIME);
    const clientID = `${creatorID(authToken)}:${random8()}:${random8()}`;
    const found: RawRecord[] = [];
    const receivedTypes = new Set<string>();
    const requestID = Math.floor(Math.random() * 1_000_000_000) + 1;
    let nextActionID = -1;
    let nextActionTime = 1;
    let settled = false;
    let closed = false;
    let incomingBytes = 0;
    let incomingRows = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (!closed) {
        closed = true;
        try { ws.close(); } catch { /* settlement must not be interrupted */ }
      }
      if (error) reject(error);
      else resolve(Object.freeze(found.slice()));
    };
    const safeSend = (frame: unknown): void => {
      if (settled) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        finish(new Error("Logux websocket error"));
      }
    };
    const timer = setTimeout(() => {
      finish(new Error("Logux connection timed out"));
    }, 15000);
    ws.onerror = () => finish(new Error("Logux websocket error"));
    ws.onclose = () => {
      if (settled) return;
      if (found.length === 0)
        finish(new Error("Logux websocket closed before sync"));
    };
    ws.onmessage = (event) => {
      if (settled) return;
      const raw = String(event.data);
      const frameBytes = new TextEncoder().encode(raw).byteLength;
      incomingBytes += frameBytes;
      if (frameBytes > MAX_LOGUX_FRAME_BYTES || incomingBytes > MAX_LOGUX_BYTES) {
        finish(new Error("Logux response exceeded the allowed size"));
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      const frame: LoguxFrame = message;
      if (frame[0] === "error") {
        // Do not include the server frame: an error frame could echo credentials.
        const reason =
          frame[1] === "wrong-credentials"
            ? "wrong-credentials"
            : "server-rejected";
        finish(new Error(`Logux connection rejected (${reason})`));
        return;
      }
      if (frame[0] === "connected") {
        // Logux subscriptions are sync actions. A bare ["subscribe", ...]
        // frame is rejected by the realtime server as an unknown message.
        for (const channel of channels) {
          if (settled) return;
          safeSend([
              "sync",
              requestID,
              {
                channel,
                type: "logux/subscribe",
                since: { id: "0", time: 0 },
              },
              { id: nextActionID--, time: nextActionTime++ },
            ]);
        }
        return;
      }
      if (frame[0] !== "sync") return;
      const action = isRecord(frame[2]) ? frame[2] : undefined;
      const payload = action && isRecord(action.payload) ? action.payload : undefined;
      const values = isUnknownArray(payload?.values) ? payload.values
        : isUnknownArray(payload?.data) ? payload.data : [];
      incomingRows += values.length;
      if (incomingRows > MAX_LOGUX_ROWS) {
        finish(new Error("Logux response exceeded the allowed row count"));
        return;
      }
      if (typeof action?.type === "string") receivedTypes.add(action.type);
      if (
        action?.type === "workspace.CRUD:REPLACE" &&
        isUnknownArray(payload?.values)
      )
        found.push(...payload.values.filter(isRecord));
      if (
        action?.type === "project.CRUD:REPLACE" &&
        isUnknownArray(payload?.values)
      )
        found.push(...payload.values.filter(isRecord));
      if (
        action?.type === "workspace-folder.REPLACE" &&
        isUnknownArray(payload?.data)
      )
        found.push(...payload.data.filter(isRecord));
      if (wanted.every((t) => receivedTypes.has(t))) {
        finish();
      }
    };
    ws.onopen = () => {
      if (settled) return;
      safeSend([
          "connect",
          4,
          clientID,
          0,
          { token: authToken, subprotocol: "1.9.0" },
        ]);
    };
  });
}

function records(
  token: string,
  channel: string,
  types: string[],
): Promise<readonly RawRecord[]> {
  return sync(token, [channel], types);
}

export async function sourceWorkspaceID(token: string): Promise<Option[]> {
  const authToken = normalizeToken(token);
  return records(authToken, `creator/${creatorID(authToken)}`, [
    "workspace.CRUD:REPLACE",
  ]).then(workspaceOptions);
}

export function sourceProjectID(
  token: string,
  sourceWorkspaceID: string,
): Promise<Option[]> {
  return records(
    token,
    `workspace/${sourceWorkspaceID}`,
    ["project.CRUD:REPLACE"],
  ).then(projectOptions(sourceWorkspaceID));
}

export function sourceVersionID(
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
): Promise<Option[]> {
  return records(
    token,
    `workspace/${sourceWorkspaceID}`,
    ["project.CRUD:REPLACE"],
  ).then(versionOptions(sourceWorkspaceID, sourceProjectID));
}

export function destinationWorkspaceID(token: string): Promise<Option[]> {
  return sourceWorkspaceID(token);
}

export function destinationFolderID(
  token: string,
  destinationWorkspaceID: string,
): Promise<Option[]> {
  return records(token, `workspace/${destinationWorkspaceID}`, [
    "workspace-folder.REPLACE",
  ]).then(folderOptions(destinationWorkspaceID));
}

export async function main(
  token: string,
  sourceWorkspaceID: DynSelect_sourceWorkspaceID,
  sourceProjectID: DynSelect_sourceProjectID,
  sourceVersionID: DynSelect_sourceVersionID,
  destinationWorkspaceID: DynSelect_destinationWorkspaceID,
  destinationFolderID: DynSelect_destinationFolderID,
  targetSchemaVersion = "13.1",
) {
  const authToken = normalizeToken(token);
  const normalizedDestinationFolderID = validateDestinationFolderID(destinationFolderID);
  if (!normalizedDestinationFolderID)
    throw new Error("Destination folder ID must be numeric");
  const { response, bytes: exported } = await fetchBoundedResponse(
    `https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/export-json/${encodeURIComponent(sourceVersionID)}`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    }, MAX_EXPORT_BYTES, 30_000,
  );
  if (response.status === 304 || !response.ok)
    throw new Error(`Export failed with HTTP ${response.status}`);
  const filename = `voiceflow-${sourceVersionID}.vf`;
  const form = new FormData();
  form.append(
    "file",
    new Blob([exported], { type: "application/octet-stream" }),
    filename,
  );
  form.append("targetSchemaVersion", targetSchemaVersion);
  form.append("folderID", normalizedDestinationFolderID);
  const { response: imported, bytes: importBytes } = await fetchBoundedResponse(
    `https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/import-file/${encodeURIComponent(destinationWorkspaceID)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json",
      },
      body: form,
    }, MAX_IMPORT_BYTES, 60_000,
  );
  if (!imported.ok)
    throw new Error(`Import failed with HTTP ${imported.status}`);
  const importResponse = parseImportResponse(importBytes);
  const projectID = extractImportedProjectID(importResponse);
  const apiKeyOutcome = await retrievePostImportApiKeyOutcome(projectID, authToken);
  return {
    exportStatus: response.status,
    importStatus: imported.status,
    exportBytes: exported.byteLength,
    selected: {
      sourceWorkspaceID,
      sourceProjectID,
      sourceVersionID,
      destinationWorkspaceID,
      destinationFolderID: normalizedDestinationFolderID,
    },
    importResponse,
    ...apiKeyOutcome,
  };
}
