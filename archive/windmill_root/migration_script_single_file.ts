/**
 * Single-file Windmill migration entrypoint.
 * This readable source inlines the complete migration dependency graph without bundling.
 */

// ---- migration_diagnostics.ts ----
type MigrationPhase =
  | "Authentication"
  | "Catalog"
  | "Export"
  | "Import"
  | "API-key retrieval";
type MigrationEndpoint =
  | "voiceflow"
  | "identity"
  | "catalog"
  | "unknown";
type MigrationCode =
  | "invalid-input"
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "rate-limited"
  | "server-error"
  | "network-error"
  | "timeout"
  | "response-too-large"
  | "read-failure"
  | "invalid-json"
  | "invalid-import-receipt"
  | "api-key-missing"
  | "api-key-ambiguous"
  | "unknown";
type MigrationDiagnostic = {
  readonly phase: MigrationPhase;
  readonly endpoint: MigrationEndpoint;
  readonly code: MigrationCode;
  readonly retryable: boolean;
  readonly diagnosticId: string;
  readonly nextAction: string;
  readonly status?: number;
  readonly contentType?: string;
  readonly responseSize?: number;
  readonly requestId?: string;
};
const safe = (value: string): string =>
  value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
class MigrationError extends Error {
  constructor(readonly diagnostic: MigrationDiagnostic) {
    super(diagnostic.code);
    this.name = "MigrationError";
  }
}
function codeForStatus(status: number): MigrationCode {
  if (status === 401 || status === 403)
    return status === 401 ? "authentication-failed" : "permission-denied";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  return status >= 500 ? "server-error" : "unknown";
}
function diagnostic(
  phase: MigrationPhase,
  code: MigrationCode,
  options: Partial<
    Omit<MigrationDiagnostic, "phase" | "code" | "diagnosticId">
  > = {},
): MigrationError {
  const retryable =
    options.retryable ??
    ["rate-limited", "server-error", "network-error", "timeout"].includes(code);
  const action =
    options.nextAction ??
    (retryable
      ? "Retry the operation."
      : "Check the migration inputs and response.");
  return new MigrationError({
    phase,
    code,
    endpoint: options.endpoint ?? "unknown",
    retryable,
    diagnosticId: crypto.randomUUID(),
    nextAction: safe(action),
    ...options,
  });
}
function asMigrationError(
  error: unknown,
  phase: MigrationPhase = "Import",
): MigrationError {
  return error instanceof MigrationError ? error : diagnostic(phase, "unknown");
}

// ---- shared_contract_types.ts ----
type WorkspaceID = string & { readonly __workspaceID: unique symbol };
type ProjectID = string & { readonly __projectID: unique symbol };
type VersionID = string & { readonly __versionID: unique symbol };
type FolderID = string & { readonly __folderID: unique symbol };
type MigrationSelection = {
  sourceWorkspaceID: string;
  sourceProjectID: string;
  sourceVersionID: string;
  destinationWorkspaceID: string;
  destinationFolderID: string;
};
type ExportArtifact = {
  bytes: ArrayBuffer;
  filename: string;
  contentType: "application/octet-stream";
  status: number;
};
type ImportedIDs = {
  projectID: string;
  devVersion?: string;
  liveVersion?: string;
  assistantID?: string;
  folderID?: string;
  workspaceID?: string;
  sourceProjectID?: string;
};
type ImportReceipt = ImportedIDs;
type MigrationResult = {
  exportStatus: number;
  importStatus: number;
  exportBytes: number;
  selected: MigrationSelection;
  imported: ImportedIDs;
  apiKeyRetrieved: boolean;
  postImport?: { readonly apiKeyRetrieved: false; readonly diagnostic: MigrationDiagnostic };
};

// ---- jwt_authentication_context.ts ----
type AuthContext = {
  readonly token: string;
  readonly creatorID: string;
};
type Claims = Record<string, unknown>;
function authenticate(rawToken: unknown): AuthContext {
  if (typeof rawToken !== "string" || !rawToken.trim())
    throw diagnostic("Authentication", "invalid-input");
  const token = rawToken.trim();
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
    throw diagnostic("Authentication", "authentication-failed");
  let claims: Claims;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")),
          (c) => c.charCodeAt(0),
        ),
      ),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw diagnostic("Authentication", "authentication-failed");
    claims = parsed as Claims;
  } catch {
    throw diagnostic("Authentication", "authentication-failed");
  }
  const id = claims.creatorID ?? claims.userID ?? claims.user_id ?? claims.sub;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    String(id).trim() === ""
  )
    throw diagnostic("Authentication", "authentication-failed");
  return { token, creatorID: String(id) };
}

// ---- http_api_client.ts ----
const VOICEFLOW_API_BASE_URL =
  "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant";
const IDENTITY_API_BASE_URL =
  "https://identity-api.empyrean.voiceflow.com/v1alpha1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 50_000_000;
const responseRequests = new WeakMap<
  Response,
  {
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    deadlineFired: () => boolean;
  }
>();
const validateAuth = (auth: AuthContext) => {
  if (
    !auth ||
    typeof auth.token !== "string" ||
    !auth.token ||
    typeof auth.creatorID !== "string" ||
    !auth.creatorID
  )
    throw new Error("Invalid authentication context");
};

function voiceflowUrl(path: string, id?: string): string {
  return `${VOICEFLOW_API_BASE_URL}/${path}${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
}

function identityApiKeyUrl(projectID: string): string {
  return `${IDENTITY_API_BASE_URL}/api-key/legacy/project/${encodeURIComponent(projectID)}`;
}

const bearerHeaders = (
  auth: AuthContext,
  accept = "application/json",
) => {
  validateAuth(auth);
  return {
    Authorization: `Bearer ${auth.token}`,
    Accept: accept,
    "Cache-Control": "no-cache",
  };
};

const identityBearerHeaders = (auth: AuthContext) => {
  return { ...bearerHeaders(auth, "*/*"), "Cache-Control": "no-store" };
};

async function fetchVoiceflow(
  phase: "Export" | "Import" | "API-key retrieval",
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let deadlineFired = false;
  const timer = setTimeout(() => {
    deadlineFired = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      response.body?.cancel();
      throw diagnostic(phase, codeForStatus(response.status), {
        endpoint: phase === "API-key retrieval" ? "identity" : "voiceflow",
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
    }
    responseRequests.set(response, {
      controller,
      timer,
      deadlineFired: () => deadlineFired,
    });
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (
      error instanceof Error &&
      /^(Export|Import|API-key retrieval) failed with HTTP/.test(error.message)
    )
      throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw diagnostic(phase, "timeout");
    if (error instanceof Error && error instanceof TypeError)
      throw diagnostic(phase, "network-error");
    throw error instanceof Error && error.name === "MigrationError"
      ? error
      : diagnostic(phase, "unknown");
  }
}

const readResponseBytes = async (
  response: Response,
  phase: "Export" | "Import" | "API-key retrieval",
  maxBytes = MAX_BODY_BYTES,
) => {
  const request = responseRequests.get(response);
  // Responses from fetchVoiceflow share one deadline for headers and body.
  if (!request) throw diagnostic(phase, "unknown");
  try {
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      request.controller.abort();
      await response.body?.cancel();
      throw diagnostic(phase, "response-too-large", {
        responseSize: Number(declared),
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
      });
    }
    if (!response.body)
      throw new Error(`${phase} response has no readable body`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw diagnostic(phase, "response-too-large", {
          responseSize: total,
          status: response.status,
        });
      }
      chunks.push(part.value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  } catch (error) {
    if (error instanceof Error && error.name === "MigrationError") throw error;
    if (
      error instanceof Error &&
      error.name === "AbortError" &&
      request.deadlineFired()
    )
      throw diagnostic(phase, "timeout", { status: response.status });
    throw diagnostic(phase, "read-failure", { status: response.status });
  } finally {
    request.controller.abort();
    clearTimeout(request.timer);
    responseRequests.delete(response);
  }
};

async function readResponseJson(
  response: Response,
  phase: "Export" | "Import" | "API-key retrieval",
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const bytes = await readResponseBytes(response, phase, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw diagnostic(phase, "invalid-json", {
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
    });
  }
}

// ---- export_project_api.ts ----
async function exportVersion(
  auth: AuthContext,
  sourceVersionID: string,
): Promise<ExportArtifact> {
  if (typeof auth?.token !== "string" || typeof auth?.creatorID !== "string")
    throw diagnostic("Export", "invalid-input");
  if (typeof sourceVersionID !== "string" || !sourceVersionID.trim())
    throw diagnostic("Export", "invalid-input");
  const r = await fetchVoiceflow(
    "Export",
    voiceflowUrl("export-json", sourceVersionID),
    { headers: bearerHeaders(auth) },
  );
  const bytes = await readResponseBytes(r, "Export");
  return {
    bytes,
    filename: "voiceflow-export.vf",
    contentType: "application/octet-stream",
    status: r.status,
  };
}

// ---- import_project_api.ts ----
const normalizeRequiredImportValue = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw diagnostic("Import", "invalid-input");
  return value.trim();
};

const normalizeReceiptValue = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : undefined;

async function importFile(
  auth: AuthContext,
  request: {
    artifact: ExportArtifact;
    destinationWorkspaceID: string | WorkspaceID;
    folderID: string | FolderID;
    targetSchemaVersion: string;
  },
): Promise<{ status: number; receipt: ImportReceipt }> {
  if (
    !auth ||
    typeof auth.token !== "string" ||
    typeof auth.creatorID !== "string"
  )
    throw diagnostic("Import", "invalid-input");
  const destinationWorkspaceID = normalizeRequiredImportValue(request.destinationWorkspaceID);
  const folderID = normalizeRequiredImportValue(request.folderID);
  const targetSchemaVersion = normalizeRequiredImportValue(request.targetSchemaVersion);
  if (
    !request.artifact ||
    request.artifact.contentType !== "application/octet-stream" ||
    typeof request.artifact.filename !== "string" ||
    !/^[A-Za-z0-9._-]+\.vf$/.test(request.artifact.filename) ||
    request.artifact.filename.includes("..") ||
    request.artifact.bytes.byteLength > 50_000_000
  )
    throw diagnostic("Import", "invalid-input");
  const form = new FormData();
  form.append(
    "file",
    new Blob([request.artifact.bytes], { type: "application/octet-stream" }),
    request.artifact.filename,
  );
  form.append("targetSchemaVersion", targetSchemaVersion);
  form.append("folderID", folderID);
  const r = await fetchVoiceflow(
    "Import",
    voiceflowUrl("import-file", destinationWorkspaceID),
    {
      method: "POST",
      headers: bearerHeaders(auth),
      body: form,
    },
  );
  const value = await readResponseJson(r, "Import", 2_000_000);
  const root =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const project =
    root.project && typeof root.project === "object"
      ? (root.project as Record<string, unknown>)
      : {};
  const assistant =
    root.assistant && typeof root.assistant === "object"
      ? (root.assistant as Record<string, unknown>)
      : {};
  const projectID = normalizeReceiptValue(project._id);
  if (!projectID)
    throw diagnostic("Import", "invalid-import-receipt", { status: r.status });
  const receipt: ImportReceipt = {
      projectID,
      devVersion: normalizeReceiptValue(project.devVersion),
      liveVersion: normalizeReceiptValue(project.liveVersion),
      assistantID: normalizeReceiptValue(assistant.id),
      folderID: normalizeReceiptValue(assistant.folderID),
      workspaceID: normalizeReceiptValue(assistant.workspaceID),
      sourceProjectID: normalizeReceiptValue(root.sourceProjectID),
  };
  if ((receipt.workspaceID !== undefined && receipt.workspaceID !== destinationWorkspaceID) || (receipt.folderID !== undefined && receipt.folderID !== folderID)) throw diagnostic("Import", "invalid-import-receipt", { status: r.status });
  return { status: r.status, receipt };
}

// ---- project_api_key_retrieval.ts ----
const MAX_RESPONSE_BYTES = 1_000_000;
const VALID_KEY = /^VF\.DM\..+$/;

function isValidVoiceflowDataManagerKey(value: unknown): value is string {
  return typeof value === "string" && VALID_KEY.test(value.trim());
}

function extractApiKeyCandidates(value: unknown): string[] {
  const candidates: string[] = [];
  if (isValidVoiceflowDataManagerKey(value)) candidates.push(value.trim());
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const field of ["apiKey", "api_key", "key", "token"]) {
      const candidate = record[field];
      if (isValidVoiceflowDataManagerKey(candidate)) candidates.push(candidate.trim());
    }
  }
  return candidates;
}

function deduplicateApiKeyCandidates(candidates: string[]): string[] {
  return [...new Set(candidates)];
}

function resolveExactlyOneApiKey(
  candidates: string[],
  responseStatus: number,
): string {
  const distinct = deduplicateApiKeyCandidates(candidates);
  const context = { endpoint: "identity", status: responseStatus };
  if (distinct.length === 0) throw diagnostic("API-key retrieval", "api-key-missing", context);
  if (distinct.length !== 1) throw diagnostic("API-key retrieval", "api-key-ambiguous", context);
  return distinct[0];
}

async function retrieveProjectApiKey(
  auth: AuthContext,
  projectID: string,
): Promise<string> {
  if (
    !auth ||
    typeof auth.token !== "string" ||
    !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(auth.token) ||
    typeof auth.creatorID !== "string" ||
    !auth.creatorID.trim() ||
    typeof projectID !== "string" ||
    !projectID.trim()
  )
    throw diagnostic("API-key retrieval", "invalid-input");
  {
    const response = await fetchVoiceflow(
      "API-key retrieval",
      identityApiKeyUrl(projectID.trim()),
      {
        method: "POST",
        headers: identityBearerHeaders(auth),
        credentials: "omit",
      },
    );
    const bytes = await readResponseBytes(
      response,
      "API-key retrieval",
      MAX_RESPONSE_BYTES,
    );
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      value = new TextDecoder().decode(bytes);
    }
    return resolveExactlyOneApiKey(extractApiKeyCandidates(value), response.status);
  }
}

// ---- logux_websocket_transport.ts ----
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

async function sync(
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

// ---- catalog_discovery_service.ts ----
type Option = { value: string; label: string };
type Row = Record<string, unknown>;
type Environment = Record<string, unknown>;

const validId = (value: string, name: string): string => {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw diagnostic("Catalog", "invalid-input", {
      endpoint: "catalog",
      nextAction: `Provide a valid ${name}.`,
    });
  return id;
};

const rowToOption = (row: Row): Option => ({
  value: String(row.id).trim(),
  label: String(row.name ?? row.title ?? row.id).trim(),
});

const filterValidRows = (rows: Row[], filter: (row: Row) => boolean): Row[] =>
  rows.filter((row) => {
    const id = String(row.id ?? "").trim();
    return id.length > 0 && filter(row);
  });

const deduplicateOptionsByValue = (
  optionsToDeduplicate: Option[],
): Option[] => [
  ...new Map(
    optionsToDeduplicate.map((option) => [option.value, option] as const),
  ).values(),
];

const sortOptionsDeterministically = (optionsToSort: Option[]): Option[] =>
  [...optionsToSort].sort(
    (a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
  );

const buildRowOptions = (
  rows: Row[],
  filter: (row: Row) => boolean,
): Option[] => {
  const validRows = filterValidRows(rows, filter);
  const optionsById = validRows
    .map(rowToOption)
    .sort((a, b) => a.value.localeCompare(b.value));
  return sortOptionsDeterministically(deduplicateOptionsByValue(optionsById));
};

const buildOptions = (rows: Row[]) => buildRowOptions(rows, () => true);
const listWorkspaces = async (token: string) => {
  const a = authenticate(token);
  return buildRowOptions(
    await sync(a, `creator/${a.creatorID}`, ["workspace.CRUD:REPLACE"]),
    () => true,
  );
};
const listProjects = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return buildRowOptions(
    await sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"]),
    (r) => String(r.workspaceID) === workspaceID,
  );
};
const listVersions = async (
  token: string,
  workspaceID: string,
  projectID: string,
) => {
  workspaceID = validId(workspaceID, "workspace ID");
  projectID = validId(projectID, "project ID");
  const a = authenticate(token),
    p = (
      await sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"])
    ).find(
      (r) =>
        String(r.id) === projectID && String(r.workspaceID) === workspaceID,
    );
  const environments = normalizeEnvironments(p?.environments);
  return sortVersionOptions(
    environments.flatMap((environment) =>
      buildVersionOptionsForEnvironment(environment, getProjectLabel(p, projectID)),
    ),
  );
};
const listFolders = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return buildRowOptions(
    await sync(a, `workspace/${workspaceID}`, ["workspace-folder.REPLACE"]),
    (r) => {
      const id = String(r.id ?? "").trim();
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const scope = r.scope;
      return (
        /^\d+$/.test(id) &&
        String(r.workspaceID) === workspaceID &&
        name.length > 0 &&
        (scope === undefined || scope === "assistant")
      );
    },
  );
};

const normalizeEnvironments = (value: unknown): Environment[] =>
  Array.isArray(value)
    ? value.filter((environment): environment is Environment =>
        isEnvironment(environment),
      )
    : Object.values(value && typeof value === "object" ? value : {}).filter(
        (environment): environment is Environment => isEnvironment(environment),
      );

const isEnvironment = (value: unknown): value is Environment =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getLabel = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim().length > 0)
    return value.trim();
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fallback;
  const record = value as Row;
  for (const candidate of [
    record.name,
    record.title,
    record.label,
    record.id,
  ]) {
    if (typeof candidate === "string" && candidate.trim().length > 0)
      return candidate.trim();
  }
  return fallback;
};

const getProjectLabel = (project: Row | undefined, fallback: string): string =>
  getLabel(project, fallback);

const getEnvironmentLabel = (environment: Environment): string =>
  getLabel(environment, "environment");

const createVersionOption = (
  environment: Environment,
  projectName: unknown,
  versionType: "Draft" | "Published",
  versionIDKey: "draftVersionID" | "publishedVersionID",
): Option | null => {
  const versionID = environment[versionIDKey];
  if (!versionID) return null;
  return {
    value: String(versionID),
    label: `[${versionType}] ${getLabel(projectName, "project")} — ${
      getEnvironmentLabel(environment)
    }`,
  };
};

const buildVersionOptionsForEnvironment = (
  environment: Environment,
  projectLabel: string,
): Option[] =>
  [
    createDraftVersionOption(environment, projectLabel),
    createPublishedVersionOption(environment, projectLabel),
  ].filter((option): option is Option => option !== null);

const createDraftVersionOption = (
  environment: Environment,
  projectName: unknown,
): Option | null =>
  createVersionOption(environment, projectName, "Draft", "draftVersionID");

const createPublishedVersionOption = (
  environment: Environment,
  projectName: unknown,
): Option | null =>
  createVersionOption(
    environment,
    projectName,
    "Published",
    "publishedVersionID",
  );

const sortVersionOptions = (versionOptions: Option[]): Option[] =>
  [...versionOptions].sort((a, b) => a.label.localeCompare(b.label));

// ---- project_migration_orchestrator.ts ----
function isMigrationSelection(value: unknown): value is MigrationSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Record<string, unknown>;
  return [
    selection.sourceWorkspaceID,
    selection.sourceProjectID,
    selection.sourceVersionID,
    selection.destinationWorkspaceID,
    selection.destinationFolderID,
  ].every((id) => typeof id === "string" && id.trim().length > 0);
}

function normalizeMigrationSelection(selection: MigrationSelection): MigrationSelection {
  return {
    sourceWorkspaceID: selection.sourceWorkspaceID.trim(),
    sourceProjectID: selection.sourceProjectID.trim(),
    sourceVersionID: selection.sourceVersionID.trim(),
    destinationWorkspaceID: selection.destinationWorkspaceID.trim(),
    destinationFolderID: selection.destinationFolderID.trim(),
  };
}

function selectMigrationIDs(
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
): MigrationSelection {
  const selection = {
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
  };
  if (!isMigrationSelection(selection)) throw diagnostic("Import", "invalid-input");
  return normalizeMigrationSelection(selection);
}

async function migrateProject(
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion = "13.1",
): Promise<MigrationResult> {
  const selection = selectMigrationIDs(
    sourceWorkspaceID, sourceProjectID, sourceVersionID,
    destinationWorkspaceID, destinationFolderID,
  );
  const a = authenticate(token),
    ex = await exportVersion(a, selection.sourceVersionID),
    im = await importFile(a, {
      artifact: ex,
      destinationWorkspaceID: selection.destinationWorkspaceID,
      folderID: selection.destinationFolderID,
      targetSchemaVersion,
    });
  const importedProjectID = typeof im.receipt.projectID === "string" ? im.receipt.projectID.trim() : "";
  let apiKeyRetrieved = false;
  let postImport: MigrationResult["postImport"];
  try { apiKeyRetrieved = (await retrieveProjectApiKey(a, importedProjectID)).startsWith("VF.DM."); }
  catch (error) { postImport = { apiKeyRetrieved: false, diagnostic: asMigrationError(error, "API-key retrieval").diagnostic }; }
  return {
    exportStatus: ex.status,
    importStatus: im.status,
    exportBytes: ex.bytes.byteLength,
    selected: {
      ...selection,
    },
    imported: im.receipt,
    apiKeyRetrieved,
    postImport,
  };
}

// ---- migration_script_entrypoint.ts ----
// Direct exports are intentional: Windmill discovers these selectors statically.
export type DynSelect_sourceWorkspaceID = string;
export type DynSelect_sourceProjectID = string;
export type DynSelect_sourceVersionID = string;
export type DynSelect_destinationWorkspaceID = string;
export type DynSelect_destinationFolderID = string;
export const sourceWorkspaceID = async (token: string) => {
  return token?.trim() ? listWorkspaces(token) : [];
};
export const sourceProjectID = async (
  token: string,
  sourceWorkspaceID: string,
) => {
  return token?.trim() && sourceWorkspaceID?.trim()
    ? listProjects(token, sourceWorkspaceID)
    : [];
};
export const sourceVersionID = async (
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
) => {
  return token?.trim() && sourceWorkspaceID?.trim() && sourceProjectID?.trim()
    ? listVersions(token, sourceWorkspaceID, sourceProjectID)
    : [];
};
export const destinationWorkspaceID = async (token: string) => {
  return token?.trim() ? listWorkspaces(token) : [];
};
export const destinationFolderID = async (
  token: string,
  destinationWorkspaceID: string,
) => {
  return token?.trim() && destinationWorkspaceID?.trim()
    ? listFolders(token, destinationWorkspaceID)
    : [];
};

const normalizeRequiredSelection = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw diagnostic("Import", "invalid-input");
  return value.trim();
};

export async function main(
  token: string,
  sourceWorkspaceID: DynSelect_sourceWorkspaceID,
  sourceProjectID: DynSelect_sourceProjectID,
  sourceVersionID: DynSelect_sourceVersionID,
  destinationWorkspaceID: DynSelect_destinationWorkspaceID,
  destinationFolderID: DynSelect_destinationFolderID,
  targetSchemaVersion = "13.1",
) {
  const selections = [
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
  ];
  const [normalizedSourceWorkspaceID, normalizedSourceProjectID,
    normalizedSourceVersionID, normalizedDestinationWorkspaceID,
    normalizedDestinationFolderID] = selections.map(normalizeRequiredSelection);
  const normalizedTargetSchemaVersion = normalizeRequiredSelection(targetSchemaVersion);
  const result = await migrateProject(
    token,
    normalizedSourceWorkspaceID,
    normalizedSourceProjectID,
    normalizedSourceVersionID,
    normalizedDestinationWorkspaceID,
    normalizedDestinationFolderID,
    normalizedTargetSchemaVersion,
  );
  return {
    exportStatus: result.exportStatus,
    importStatus: result.importStatus,
    exportBytes: result.exportBytes,
    selected: result.selected,
    imported: result.imported,
    apiKeyRetrieved: result.apiKeyRetrieved,
    postImport: result.postImport,
  };
}
