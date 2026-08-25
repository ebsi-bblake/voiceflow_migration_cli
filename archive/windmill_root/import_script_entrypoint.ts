import { authenticate } from "./jwt_authentication_context";
import { importFile } from "./import_project_api";
import { diagnostic } from "./migration_diagnostics";

// token is the raw JWT only; do not pass a Bearer-prefixed value.

const MAX_IMPORT_BYTES = 50_000_000;
const SAFE_FILENAME = /^[A-Za-z0-9._-]+\.vf$/;

const normalizeRequiredInput = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw diagnostic("Import", "invalid-input");
  return value.trim();
};

export async function main(
  token: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  exportBase64: string,
  exportFilename = "voiceflow-export.vf",
  targetSchemaVersion = "13.1",
) {
  const normalizedDestinationWorkspaceID = normalizeRequiredInput(destinationWorkspaceID);
  const normalizedDestinationFolderID = normalizeRequiredInput(destinationFolderID);
  const normalizedTargetSchemaVersion = normalizeRequiredInput(targetSchemaVersion);
  if (
    !SAFE_FILENAME.test(exportFilename) ||
    exportFilename.length > 255 ||
    exportFilename.includes("..")
  )
    throw diagnostic("Import", "invalid-input");
  if (
    typeof exportBase64 !== "string" ||
    !exportBase64 ||
    exportBase64.length > Math.ceil(MAX_IMPORT_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(exportBase64) ||
    exportBase64.length % 4 !== 0
  )
    throw diagnostic("Import", "invalid-input");
  const binary = atob(exportBase64);
  if (binary.length > MAX_IMPORT_BYTES)
    throw diagnostic("Import", "response-too-large");
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  ).buffer;
  const result = await importFile(authenticate(token), {
    artifact: {
      bytes,
      filename: exportFilename,
      contentType: "application/octet-stream",
      status: 200,
    },
    destinationWorkspaceID: normalizedDestinationWorkspaceID,
    folderID: normalizedDestinationFolderID,
    targetSchemaVersion: normalizedTargetSchemaVersion,
  });
  return {
    status: result.status,
    byteLength: bytes.byteLength,
    imported: result.receipt,
  };
}
