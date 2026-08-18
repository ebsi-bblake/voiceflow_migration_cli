export type WorkspaceID = string & { readonly __workspaceID: unique symbol };
export type ProjectID = string & { readonly __projectID: unique symbol };
export type VersionID = string & { readonly __versionID: unique symbol };
export type FolderID = string & { readonly __folderID: unique symbol };
export type MigrationSelection = {
  sourceWorkspaceID: string;
  sourceProjectID: string;
  sourceVersionID: string;
  destinationWorkspaceID: string;
  destinationFolderID: string;
};
export type ExportArtifact = {
  bytes: ArrayBuffer;
  filename: string;
  contentType: "application/octet-stream";
  status: number;
};
export type ImportedIDs = {
  projectID: string;
  devVersion?: string;
  liveVersion?: string;
  assistantID?: string;
  folderID?: string;
  workspaceID?: string;
  sourceProjectID?: string;
};
export type ImportReceipt = ImportedIDs;
export type MigrationResult = {
  exportStatus: number;
  importStatus: number;
  exportBytes: number;
  selected: MigrationSelection;
  imported: ImportedIDs;
  apiKeyRetrieved: boolean;
  postImport?: { readonly apiKeyRetrieved: false; readonly diagnostic: import("./migration_diagnostics").MigrationDiagnostic };
};
