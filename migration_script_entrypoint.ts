import { migrateProject } from "./project_migration_orchestrator";
import {
  listWorkspaces,
  listProjects,
  listVersions,
  listFolders,
} from "./catalog_discovery_service";
import { diagnostic } from "./migration_diagnostics";
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

const normalizeRequiredSelection = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw diagnostic("Import", "invalid-input");
  return value.trim();
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
  const selections = [
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
  ];
  const [normalizedSourceWorkspaceID, normalizedSourceProjectID,
    normalizedSourceVersionID, normalizedDestinationWorkspaceID,
    normalizedDestinationFolderID] = selections.map(normalizeRequiredSelection);
  const normalizedTargetSchemaVersion = normalizeRequiredSelection(targetSchemaVersion);
  const result = await migrateProject(
    token,
    normalizedSourceWorkspaceID,
    normalizedSourceProjectID,
    normalizedSourceVersionID,
    normalizedDestinationWorkspaceID,
    normalizedDestinationFolderID,
    normalizedTargetSchemaVersion,
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
