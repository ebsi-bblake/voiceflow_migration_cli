import {
  listWorkspaces,
  listProjects,
  listVersions,
  listFolders,
} from "./catalog_discovery_service";
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
