import type { AuthContext } from "./jwt_authentication_context";
import type {
  ExportArtifact,
  FolderID,
  ImportReceipt,
  WorkspaceID,
} from "./shared_contract_types";
import {
  bearerHeaders,
  fetchVoiceflow,
  readResponseJson,
  voiceflowUrl,
} from "./http_api_client";
import { diagnostic } from "./migration_diagnostics";

const normalizeRequiredImportValue = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw diagnostic("Import", "invalid-input");
  return value.trim();
};

const normalizeReceiptValue = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : undefined;

export async function importFile(
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
