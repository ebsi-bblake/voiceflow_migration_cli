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
export async function sourceWorkspaceID(token: string) {
  return token?.trim() ? listWorkspaces(token) : [];
}
export async function sourceProjectID(
  token: string,
  sourceWorkspaceID: string,
) {
  return token?.trim() && sourceWorkspaceID?.trim()
    ? listProjects(token, sourceWorkspaceID)
    : [];
}
export async function sourceVersionID(
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
) {
  return token?.trim() && sourceWorkspaceID?.trim() && sourceProjectID?.trim()
    ? listVersions(token, sourceWorkspaceID, sourceProjectID)
    : [];
}
export async function destinationWorkspaceID(token: string) {
  return token?.trim() ? listWorkspaces(token) : [];
}
export async function destinationFolderID(
  token: string,
  destinationWorkspaceID: string,
) {
  return token?.trim() && destinationWorkspaceID?.trim()
    ? listFolders(token, destinationWorkspaceID)
    : [];
}
