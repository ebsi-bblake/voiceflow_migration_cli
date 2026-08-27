import type { AuthContext } from "./types";
import type { ExportArtifact, HttpBytes, ImportedReceipt } from "./types";
import { OperationFault } from "./vf_contracts";
import { requestBytes } from "./vf_http";
import { requireVoiceflowString } from "./vf_validation";
import { isImportOutcomeUnknownStatus, isRecord } from "./guards";

type RecordValue = Readonly<Record<string, unknown>>;

type RequiredFolderID = (value: unknown) => string;
const requiredFolderID: RequiredFolderID = (value) => {
  const folderID = requireVoiceflowString(value);
  if (!isNumericFolder(folderID)) {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return folderID;
};

type ValidFilename = (value: string) => string;
const validFilename: ValidFilename = (value) => {
  const name = value.trim();
  if (!isSafeFilename(name))
    throw new OperationFault("INVALID_ARGUMENT");
  return name;
};
const isNumericFolder = (value: string): boolean => /^\d+$/.test(value);
const isSafeFilename = (value: string): boolean => {
  if (!/^[^/\\]+\.vf$/i.test(value)) return false;
  return !value.includes("..");
};

type PrimitiveID = (value: unknown) => string | undefined;
const primitiveID: PrimitiveID = (value) => {
  if (!isPrimitiveID(value)) return undefined;
  const id = String(value).trim();
  return nonEmptyID(id);
};
const nonEmptyID = (id: string): string | undefined => id === "" ? undefined : id;
const isPrimitiveID = (value: unknown): value is string | number => {
  if (typeof value === "string") return true;
  return typeof value === "number";
};

type NestedProjectID = (row: RecordValue) => string | undefined;
const nestedProjectID: NestedProjectID = (row) => {
  if (!isRecord(row.project)) return undefined;
  return primitiveID(row.project._id);
};

export { isImportOutcomeUnknownStatus } from "./guards";

type Receipt = (
  value: unknown,
  status: number,
  bytes: number,
) => ImportedReceipt;
const receipt: Receipt = (value, status, bytes) => {
  if (!isRecord(value)) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return receiptFromRecord(value, status, bytes);
};
const receiptFromRecord = (value: RecordValue, status: number, bytes: number): ImportedReceipt => {
  const projectID = projectIDFromRecord(value);
  if (projectID === undefined) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return {
    importStatus: status,
    importBytes: bytes,
    projectID,
    assistantID: primitiveID(value.assistantID),
    workspaceID: primitiveID(value.workspaceID),
    folderID: primitiveID(value.folderID),
  };
};
const projectIDFromRecord = (value: RecordValue): string | undefined =>
  firstProjectID(value) ?? nestedProjectID(value);
const firstProjectID = (value: RecordValue): string | undefined =>
  [value.projectID, value.projectId, value.id].map(primitiveID).find((id) => id !== undefined);

type ImportVersion = (
  auth: AuthContext,
  artifact: ExportArtifact,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion: string,
) => Promise<ImportedReceipt>;
export const importVersion: ImportVersion = async (
  auth,
  artifact,
  destinationWorkspaceID,
  destinationFolderID,
  targetSchemaVersion,
) => {
  const input = importInput(destinationWorkspaceID, destinationFolderID, targetSchemaVersion, artifact);
  const form = new FormData();
  form.append(
    "file",
    new Blob([artifact.bytes], { type: "application/octet-stream" }),
    validFilename(artifact.filename),
  );
  form.append("targetSchemaVersion", input.schema);
  form.append("folderID", input.folder);
  const response = await requestImportResponse(auth, input.workspace, form);
  return parseImportResponse(response, artifact.bytes.byteLength);
};

type ImportInput = { readonly workspace: string; readonly folder: string; readonly schema: string };
type ImportInputFactory = (workspace: string, folder: string, schema: string, artifact: ExportArtifact) => ImportInput;
const importInput: ImportInputFactory = (workspace, folder, schema, artifact) => {
  const normalizedWorkspace = requireVoiceflowString(workspace);
  validateArtifactSize(artifact);
  return { workspace: normalizedWorkspace, folder: requiredFolderID(folder), schema: requireVoiceflowString(schema) };
};
const validateArtifactSize = (artifact: ExportArtifact): void => {
  if (artifact.bytes.byteLength > 50_000_000) throw new OperationFault("INVALID_ARGUMENT");
};
type RequestImportResponse = (auth: AuthContext, workspace: string, form: FormData) => Promise<HttpBytes>;
const requestImportResponse: RequestImportResponse = async (auth, workspace, form) => {
  try {
    return await requestBytes({
      url: `https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/import-file/${encodeURIComponent(workspace)}`,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
        body: form,
      },
      maxBytes: 2_097_152,
      timeoutMs: 60_000,
    });
  } catch (error) {
    throw importRequestFault(error);
  }
};
type ImportRequestFault = (error: unknown) => OperationFault | unknown;
const importRequestFault: ImportRequestFault = (error) =>
  isUnknownImportDependency(error) ? new OperationFault("IMPORT_OUTCOME_UNKNOWN") : error;
const isUnknownImportDependency = (error: unknown): error is OperationFault => {
  if (!(error instanceof OperationFault)) return false;
  return ["DEPENDENCY_TIMEOUT", "DEPENDENCY_FAILURE"].includes(error.code);
};

type ParseImportResponse = (response: HttpBytes, bytes: number) => ImportedReceipt;
const parseImportResponse: ParseImportResponse = (response, bytes) => {
  validateImportStatus(response.status);
  return receipt(parseImportBody(response.bytes), response.status, bytes);
};
const validateImportStatus = (status: number): void => {
  if (isImportOutcomeUnknownStatus(status)) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  ensureSuccessfulStatus(status);
};
const ensureSuccessfulStatus = (status: number): void => {
  if (!isSuccessfulStatus(status)) throw new OperationFault("DEPENDENCY_FAILURE");
};
const isSuccessfulStatus = (status: number): boolean => status >= 200 && status < 300;
const parseImportBody = (bytes: ArrayBuffer): unknown => {
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new OperationFault("IMPORT_OUTCOME_UNKNOWN"); }
};
