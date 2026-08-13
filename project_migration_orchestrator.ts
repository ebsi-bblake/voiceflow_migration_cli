import { authenticate } from "./jwt_authentication_context.ts";
import { exportVersion } from "./export_project_api.ts";
import { importFile } from "./import_project_api.ts";
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
    throw new Error("All migration selections are required");
  const a = authenticate(token),
    ex = await exportVersion(a, sourceVersionID),
    im = await importFile(a, {
      artifact: ex,
      destinationWorkspaceID,
      folderID: destinationFolderID,
      targetSchemaVersion,
    });
  return {
    exportStatus: ex.status,
    importStatus: im.status,
    exportBytes: ex.bytes.byteLength,
    selected: {
      sourceWorkspaceID,
      sourceProjectID,
      sourceVersionID,
      destinationWorkspaceID,
      destinationFolderID,
    },
    imported: im.receipt,
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
