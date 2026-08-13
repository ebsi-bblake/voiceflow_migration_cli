import { authenticate } from "./jwt_authentication_context.ts";
import { exportVersion } from "./export_project_api.ts";
import { importFile } from "./import_project_api.ts";
import { retrieveProjectApiKey } from "./project_api_key_retrieval.ts";
import { diagnostic, asMigrationError } from "./migration_diagnostics.ts";
import type { MigrationResult } from "./shared_contract_types.ts";
import {
  listWorkspaces,
  listProjects,
  listVersions,
  listFolders,
} from "./catalog_discovery_service.ts";
export type DynSelect_sourceWorkspaceID = string;
export type DynSelect_sourceProjectID = string;
export type DynSelect_sourceVersionID = string;
export type DynSelect_destinationWorkspaceID = string;
export type DynSelect_destinationFolderID = string;
export const sourceWorkspaceID = (token: string) => listWorkspaces(token);
export const sourceProjectID = (token: string, sourceWorkspaceID: string) =>
  listProjects(token, sourceWorkspaceID);
export const sourceVersionID = (
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
) => listVersions(token, sourceWorkspaceID, sourceProjectID);
export const destinationWorkspaceID = (token: string) => listWorkspaces(token);
export const destinationFolderID = (
  token: string,
  destinationWorkspaceID: string,
) => listFolders(token, destinationWorkspaceID);
export async function migrateProject(
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion = "13.1",
): Promise<MigrationResult> {
  const ids = [
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
  ];
  if (ids.some((x) => typeof x !== "string" || !x.trim()))
    throw diagnostic("Import", "invalid-input");
  const normalized = ids.map((id) => id.trim());
  const [sourceWorkspace, sourceProject, sourceVersion, destinationWorkspace, destinationFolder] = normalized;
  const a = authenticate(token),
    ex = await exportVersion(a, sourceVersion),
    im = await importFile(a, {
      artifact: ex,
      destinationWorkspaceID: destinationWorkspace,
      folderID: destinationFolder,
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
      sourceWorkspaceID: sourceWorkspace,
      sourceProjectID: sourceProject,
      sourceVersionID: sourceVersion,
      destinationWorkspaceID: destinationWorkspace,
      destinationFolderID: destinationFolder,
    },
    imported: im.receipt,
    apiKeyRetrieved,
    postImport,
  };
}
export async function main(
  token: string,
  sourceWorkspaceID: DynSelect_sourceWorkspaceID,
  sourceProjectID: DynSelect_sourceProjectID,
  sourceVersionID: DynSelect_sourceVersionID,
  destinationWorkspaceID: DynSelect_destinationWorkspaceID,
  destinationFolderID: DynSelect_destinationFolderID,
  targetSchemaVersion = "13.1",
): Promise<MigrationResult> {
  return migrateProject(
    token,
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion,
  );
}
