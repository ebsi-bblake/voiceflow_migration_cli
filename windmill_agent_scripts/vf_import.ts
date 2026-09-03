import type { AuthContext } from "./vf_auth";
import type { ExportArtifact } from "./vf_export";
import type { ImportedReceipt } from "./vf_contracts";
import { OperationFault } from "./vf_contracts";
import { VoiceflowRegex } from "./vf_regex";
import { requestBytes, type HttpBytes } from "./vf_http";
import { parseFolderID, parseSchemaVersion, parseWorkspaceID } from "./vf_validation";

function requiredFolderID(value: unknown): string {
  return parseFolderID(value);
}

function isSafeFilename(value: string): boolean {
  return VoiceflowRegex.filename.test(value) && !value.includes("..");
}

function validFilename(value: string): string {
  const name = value.trim();
  if (!isSafeFilename(name)) throw new OperationFault("INVALID_ARGUMENT");
  return name;
}

function isStringOrNumber(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function normalizePrimitiveID(value: string | number): string | undefined {
  const id = String(value).trim();
  return id || undefined;
}

function primitiveID(value: unknown): string | undefined {
  return isStringOrNumber(value) ? normalizePrimitiveID(value) : undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

type ImportResponseRecord = Readonly<{
  projectID?: unknown;
  projectId?: unknown;
  id?: unknown;
  project?: unknown;
  assistantID?: unknown;
  workspaceID?: unknown;
  folderID?: unknown;
}>;

function nestedProjectID(row: ImportResponseRecord): string | undefined {
  if (!isRecord(row.project)) return undefined;
  return primitiveID(row.project._id);
}

function readProjectID(row: ImportResponseRecord): string | undefined {
  return (
    [row.projectID, row.projectId, row.id]
      .map(primitiveID)
      .find((id): id is string => id !== undefined) ?? nestedProjectID(row)
  );
}

function requireImportRecord(value: unknown): ImportResponseRecord {
  if (!isRecord(value)) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return value;
}

function requireProjectID(value: ImportResponseRecord): string {
  const projectID = readProjectID(value);
  if (!projectID) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return projectID;
}

type Receipt = (
  value: unknown,
  status: number,
  bytes: number,
) => ImportedReceipt;

const receipt: Receipt = (value, status, bytes) => {
  const row = requireImportRecord(value);
  return {
    importStatus: status,
    importBytes: bytes,
    projectID: requireProjectID(row),
    assistantID: primitiveID(row.assistantID),
    workspaceID: primitiveID(row.workspaceID),
    folderID: primitiveID(row.folderID),
  };
};

function validateArtifactSize(artifact: ExportArtifact): void {
  if (artifact.bytes.byteLength > 50_000_000)
    throw new OperationFault("INVALID_ARGUMENT");
}

function buildImportForm(
  artifact: ExportArtifact,
  folder: string,
  schema: string,
): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([artifact.bytes], { type: "application/octet-stream" }),
    validFilename(artifact.filename),
  );
  form.append("targetSchemaVersion", schema);
  form.append("folderID", folder);
  return form;
}

function isUnknownImportDependency(error: unknown): boolean {
  return (
    error instanceof OperationFault &&
    ["DEPENDENCY_TIMEOUT", "DEPENDENCY_FAILURE"].includes(error.code)
  );
}

function translateImportRequestError(error: unknown): unknown {
  if (isUnknownImportDependency(error))
    return new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return error;
}

async function requestImport(
  auth: AuthContext,
  workspace: string,
  form: FormData,
): Promise<HttpBytes> {
  return requestBytes({
    url: `https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/import-file/${encodeURIComponent(workspace)}`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
      body: form,
    },
    maxBytes: 2_097_152,
    timeoutMs: 60_000,
  }).catch((error) => Promise.reject(translateImportRequestError(error)));
}

const unknownImportStatuses = new Set([408, 429]);

function isUnknownImportStatus(status: number): boolean {
  return unknownImportStatuses.has(status) || status >= 500;
}

function isUnsuccessfulStatus(status: number): boolean {
  return status < 200 || status >= 300;
}

// Status handling is the explicit import outcome policy.
function validateImportStatus(status: number): void {
  if (isUnknownImportStatus(status))
    throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  if (isUnsuccessfulStatus(status))
    throw new OperationFault("DEPENDENCY_FAILURE");
}

function parseImportResponse(
  response: HttpBytes,
  artifactBytes: number,
): ImportedReceipt {
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
    return receipt(body, response.status, artifactBytes);
  } catch (error) {
    throw toImportParseError(error);
  }
}

function toImportParseError(error: unknown): OperationFault {
  return error instanceof OperationFault
    ? error
    : new OperationFault("IMPORT_OUTCOME_UNKNOWN");
}

export async function importVersion(
  auth: AuthContext,
  artifact: ExportArtifact,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion: string,
): Promise<ImportedReceipt> {
  const workspace = parseWorkspaceID(destinationWorkspaceID);
  const folder = requiredFolderID(destinationFolderID);
  const schema = parseSchemaVersion(targetSchemaVersion);
  validateArtifactSize(artifact);
  const response = await requestImport(
    auth,
    workspace,
    buildImportForm(artifact, folder, schema),
  );
  validateImportStatus(response.status);
  return parseImportResponse(response, artifact.bytes.byteLength);
}
