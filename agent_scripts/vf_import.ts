import type { AuthContext } from "./vf_auth";
import type { ExportArtifact } from "./vf_export";
import type { ImportedReceipt } from "./vf_contracts";
import { OperationFault } from "./vf_contracts";
import { requestBytes, type HttpBytes } from "./vf_http";

type RecordValue = Readonly<Record<string, unknown>>;

type IsRecord = (value: unknown) => value is RecordValue;
const isRecord: IsRecord = (value): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RequiredID = (value: unknown) => string;
const requiredID: RequiredID = (value) => {
  if (typeof value !== "string" || !value.trim())
    throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
};

type RequiredFolderID = (value: unknown) => string;
const requiredFolderID: RequiredFolderID = (value) => {
  const folderID = requiredID(value);
  if (!/^\d+$/.test(folderID)) {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return folderID;
};

type ValidFilename = (value: string) => string;
const validFilename: ValidFilename = (value) => {
  const name = value.trim();
  if (!/^[^/\\]+\.vf$/i.test(name) || name.includes(".."))
    throw new OperationFault("INVALID_ARGUMENT");
  return name;
};

type PrimitiveID = (value: unknown) => string | undefined;
const primitiveID: PrimitiveID = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  return id || undefined;
};

type NestedProjectID = (row: RecordValue) => string | undefined;
const nestedProjectID: NestedProjectID = (row) => {
  if (!isRecord(row.project)) return undefined;
  return primitiveID(row.project._id);
};

type Receipt = (
  value: unknown,
  status: number,
  bytes: number,
) => ImportedReceipt;
const receipt: Receipt = (value, status, bytes) => {
  if (!isRecord(value)) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  const projectID =
    primitiveID(value.projectID ?? value.projectId ?? value.id) ??
    nestedProjectID(value);
  if (!projectID) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return {
    importStatus: status,
    importBytes: bytes,
    projectID,
    assistantID: primitiveID(value.assistantID),
    workspaceID: primitiveID(value.workspaceID),
    folderID: primitiveID(value.folderID),
  };
};

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
  const workspace = requiredID(destinationWorkspaceID);
  const folder = requiredFolderID(destinationFolderID);
  const schema = requiredID(targetSchemaVersion);
  if (artifact.bytes.byteLength > 50_000_000)
    throw new OperationFault("INVALID_ARGUMENT");
  const form = new FormData();
  form.append(
    "file",
    new Blob([artifact.bytes], { type: "application/octet-stream" }),
    validFilename(artifact.filename),
  );
  form.append("targetSchemaVersion", schema);
  form.append("folderID", folder);
  let response: HttpBytes;
  try {
    response = await requestBytes({
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
    if (
      error instanceof OperationFault &&
      (error.code === "DEPENDENCY_TIMEOUT" ||
        error.code === "DEPENDENCY_FAILURE")
    ) {
      throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
    }
    throw error;
  }
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new OperationFault("DEPENDENCY_FAILURE");
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
    return receipt(body, response.status, artifact.bytes.byteLength);
  } catch {
    throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  }
};
