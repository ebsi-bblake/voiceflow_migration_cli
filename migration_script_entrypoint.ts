import { migrateProject } from "./project_migration_orchestrator.ts";
import {
  listWorkspaces,
  listProjects,
  listVersions,
  listFolders,
} from "./catalog_discovery_service.ts";

/*
  sourceWorkspaceID,
  sourceProjectID,
  sourceVersionID,
  destinationWorkspaceID,
  destinationFolderID,
} from "./project_migration_orchestrator.ts"; */
// Direct exports are intentional: Windmill discovers these selectors statically.
export type DynSelect_sourceWorkspaceID = string;
export type DynSelect_sourceProjectID = string;
export type DynSelect_sourceVersionID = string;
export type DynSelect_destinationWorkspaceID = string;
export type DynSelect_destinationFolderID = string;
export const sourceWorkspaceID = async (token: string) => {
  return token?.trim() ? listWorkspaces(token) : [];
};
export const sourceProjectID = async (
  token: string,
  sourceWorkspaceID: string,
) => {
  return token?.trim() && sourceWorkspaceID?.trim()
    ? listProjects(token, sourceWorkspaceID)
    : [];
};
export const sourceVersionID = async (
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
) => {
  return token?.trim() && sourceWorkspaceID?.trim() && sourceProjectID?.trim()
    ? listVersions(token, sourceWorkspaceID, sourceProjectID)
    : [];
};
export const destinationWorkspaceID = async (token: string) => {
  return token?.trim() ? listWorkspaces(token) : [];
};
export const destinationFolderID = async (
  token: string,
  destinationWorkspaceID: string,
) => {
  return token?.trim() && destinationWorkspaceID?.trim()
    ? listFolders(token, destinationWorkspaceID)
    : [];
};

export async function main(
  token: string,
  sourceWorkspaceID: DynSelect_sourceWorkspaceID,
  sourceProjectID: DynSelect_sourceProjectID,
  sourceVersionID: DynSelect_sourceVersionID,
  destinationWorkspaceID: DynSelect_destinationWorkspaceID,
  destinationFolderID: DynSelect_destinationFolderID,
  targetSchemaVersion = "13.1",
) {
  const ids = [
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
  ];
  if (ids.some((id) => typeof id !== "string" || !id.trim()))
    throw new Error("All migration selections are required");
  if (typeof targetSchemaVersion !== "string" || !targetSchemaVersion.trim())
    throw new Error("Target schema version is required");
  const result = await migrateProject(
    token,
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion,
  );
  return {
    exportStatus: result.exportStatus,
    importStatus: result.importStatus,
    exportBytes: result.exportBytes,
    selected: result.selected,
    imported: result.imported,
    apiKeyRetrieved: result.apiKeyRetrieved,
    postImport: result.postImport,
  };
}
