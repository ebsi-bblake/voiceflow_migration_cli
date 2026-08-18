import type { AuthContext } from "./vf_auth";
import type { ExportArtifact } from "./vf_export";
import type { ImportedReceipt } from "./vf_contracts";
import { OperationFault } from "./vf_contracts";
import { requestBytes } from "./vf_http";
function requiredID(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
}

function requiredFolderID(value: unknown): string {
  const folderID = requiredID(value);
  if (!/^\d+$/.test(folderID)) {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return folderID;
}
function validFilename(value: string): string {
  const name = value.trim();
  if (!/^[^/\\]+\.vf$/i.test(name) || name.includes(".."))
    throw new OperationFault("INVALID_ARGUMENT");
  return name;
}
function primitiveID(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  return id || undefined;
}
function nestedProjectID(row: Record<string, unknown>): string | undefined {
  if (
    !row.project ||
    typeof row.project !== "object" ||
    Array.isArray(row.project)
  )
    return undefined;
  return primitiveID((row.project as Record<string, unknown>)._id);
}
function receipt(
  value: unknown,
  status: number,
  bytes: number,
): ImportedReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  const row = value as Record<string, unknown>;
  const projectID =
    primitiveID(row.projectID ?? row.projectId ?? row.id) ??
    nestedProjectID(row);
  if (!projectID) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return {
    importStatus: status,
    importBytes: bytes,
    projectID,
    assistantID: primitiveID(row.assistantID),
    workspaceID: primitiveID(row.workspaceID),
    folderID: primitiveID(row.folderID),
  };
}
export async function importVersion(
  auth: AuthContext,
  artifact: ExportArtifact,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion: string,
): Promise<ImportedReceipt> {
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
  let response;
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
    const body = JSON.parse(new TextDecoder().decode(response.bytes));
    return receipt(body, response.status, artifact.bytes.byteLength);
  } catch {
    throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  }
}
