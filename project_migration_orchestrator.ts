import { authenticate } from "./jwt_authentication_context";
import { exportVersion } from "./export_project_api";
import { importFile } from "./import_project_api";
import { retrieveProjectApiKey } from "./project_api_key_retrieval";
import { diagnostic, asMigrationError } from "./migration_diagnostics";
import type { MigrationResult, MigrationSelection } from "./shared_contract_types";

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

export async function migrateProject(
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
