import type { AuthContext } from "./jwt_authentication_context.ts";
import type {
  ExportArtifact,
  FolderID,
  ImportReceipt,
  WorkspaceID,
} from "./shared_contract_types.ts";
import {
  bearerHeaders,
  fetchVoiceflow,
  readResponseJson,
  voiceflowUrl,
} from "./http_api_client.ts";
import { diagnostic } from "./migration_diagnostics.ts";
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
  if (
    !String(request.destinationWorkspaceID).trim() ||
    !String(request.folderID).trim() ||
    typeof request.targetSchemaVersion !== "string" ||
    !request.targetSchemaVersion.trim()
  )
    throw diagnostic("Import", "invalid-input");
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
  form.append("targetSchemaVersion", request.targetSchemaVersion);
  form.append("folderID", String(request.folderID));
  const r = await fetchVoiceflow(
    "Import",
    voiceflowUrl("import-file", String(request.destinationWorkspaceID)),
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
  const primitive = (v: unknown): string | undefined =>
    typeof v === "string" || typeof v === "number" ? String(v) : undefined;
  const projectID = primitive(project._id)?.trim();
  if (!projectID)
    throw diagnostic("Import", "invalid-import-receipt", { status: r.status });
  const receipt: ImportReceipt = {
      projectID,
      devVersion: primitive(project.devVersion),
      liveVersion: primitive(project.liveVersion),
      assistantID: primitive(assistant.id),
      folderID: primitive(assistant.folderID),
      workspaceID: primitive(assistant.workspaceID),
      sourceProjectID: primitive(root.sourceProjectID),
  };
  if ((receipt.workspaceID !== undefined && receipt.workspaceID !== String(request.destinationWorkspaceID).trim()) || (receipt.folderID !== undefined && receipt.folderID !== String(request.folderID).trim())) throw diagnostic("Import", "invalid-import-receipt", { status: r.status });
  return { status: r.status, receipt };
}
