import { authenticate } from "./jwt_authentication_context";
import { exportVersion } from "./export_project_api";
import { importFile } from "./import_project_api";
import { retrieveProjectApiKey } from "./project_api_key_retrieval";
import { diagnostic, asMigrationError } from "./migration_diagnostics";
import type {
  MigrationApiKeyOutcome,
  MigrationResult,
  MigrationSelection,
} from "./shared_contract_types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMigrationSelection(value: unknown): value is MigrationSelection {
  if (!isRecord(value)) return false;
  const selection = value;
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

function normalizeImportedProjectID(projectID: unknown): string {
  return typeof projectID === "string" ? projectID.trim() : "";
}

async function retrieveApiKeyOutcome(
  auth: Awaited<ReturnType<typeof authenticate>>,
  importedProjectID: string,
): Promise<MigrationApiKeyOutcome> {
  try {
    const apiKey = await retrieveProjectApiKey(auth, importedProjectID);
    return {
      apiKeyRetrieved: apiKey.startsWith("VF.DM."),
      postImport: undefined,
    };
  } catch (error) {
    return {
      apiKeyRetrieved: false,
      postImport: {
        apiKeyRetrieved: false,
        diagnostic: asMigrationError(error, "API-key retrieval").diagnostic,
      },
    };
  }
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
  const auth = authenticate(token);
  const exportArtifact = await exportVersion(auth, selection.sourceVersionID);
  const importResult = await importFile(auth, {
      artifact: exportArtifact,
      destinationWorkspaceID: selection.destinationWorkspaceID,
      folderID: selection.destinationFolderID,
      targetSchemaVersion,
    });
  const importedProjectID = normalizeImportedProjectID(importResult.receipt.projectID);
  const apiKeyOutcome = await retrieveApiKeyOutcome(auth, importedProjectID);
  return {
    exportStatus: exportArtifact.status,
    importStatus: importResult.status,
    exportBytes: exportArtifact.bytes.byteLength,
    selected: {
      ...selection,
    },
    imported: importResult.receipt,
    ...apiKeyOutcome,
  };
}
