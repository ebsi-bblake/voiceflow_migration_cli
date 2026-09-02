export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "AUTHENTICATION_FAILED"
  | "VOICEFLOW_LOGIN_REQUIRED"
  | "NOT_FOUND"
  | "DEPENDENCY_TIMEOUT"
  | "DEPENDENCY_FAILURE"
  | "PLAN_MISMATCH"
  | "CONFIRMATION_REQUIRED"
  | "IMPORT_OUTCOME_UNKNOWN"
  | "INTERNAL_ERROR";
export type WarningCode = "NOT_IDEMPOTENT" | "API_KEY_RETRIEVAL_FAILED";
export type Warning = Readonly<{ code: WarningCode; message: string }>;
export type OperationError = Readonly<{
  code: ErrorCode;
  message: string;
  retryable: boolean;
}>;
export type Success<T> = {
  readonly ok: true;
  readonly operation: string;
  readonly operationID: string;
  readonly result: T;
  readonly warnings: readonly Warning[];
};
export type Failure = {
  readonly ok: false;
  readonly operation: string;
  readonly operationID: string;
  readonly error: OperationError;
};
export type Envelope<T> = Success<T> | Failure;
export type MigrationSelection = Readonly<{
  sourceWorkspaceID: string;
  sourceProjectID: string;
  sourceVersionID: string;
  destinationWorkspaceID: string;
  destinationFolderID: string;
  targetSchemaVersion: string;
}>;
export type MigrationPlan = Readonly<{
  planID: string;
  selection: MigrationSelection;
  labels: Readonly<{
    sourceWorkspace: string;
    sourceProject: string;
    sourceVersion: string;
    destinationWorkspace: string;
    destinationFolder: string;
  }>;
}>;
export type ImportedReceipt = Readonly<{
  importStatus: number;
  importBytes: number;
  projectID: string;
  assistantID?: string;
  workspaceID?: string;
  folderID?: string;
}>;
export type AuthContext = Readonly<{ token: string; creatorID: string }>;
export type SecretEntry = Readonly<{ name: string; value: string }>;
export type ApiKeyDiagnostic = Readonly<{ code: string; message: string }>;
export type ApiKeyStatus =
  | { readonly apiKeyRetrieved: true; readonly postImport?: never }
  | {
      readonly apiKeyRetrieved: false;
      readonly postImport: {
        readonly apiKeyRetrieved: false;
        readonly diagnostic: ApiKeyDiagnostic;
      };
    };
export type RequestBytesInput = Readonly<{
  url: string;
  init?: RequestInit;
  maxBytes: number;
  timeoutMs: number;
}>;
export type HttpBytes = Readonly<{
  status: number;
  headers: Headers;
  bytes: ArrayBuffer;
}>;
export type ExportArtifact = Readonly<{
  status: number;
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
}>;
export type Option = Readonly<{ value: string; label: string }>;
export type WorkspaceRecord = Readonly<{ id: string; label: string }>;
export type EnvironmentRecord = Readonly<{
  label: string;
  draftVersionID?: string;
  publishedVersionID?: string;
}>;
export type ProjectRecord = Readonly<{
  id: string;
  label: string;
  workspaceID: string;
  environments: readonly EnvironmentRecord[];
}>;
export type FolderRecord = Readonly<{
  id: string;
  label: string;
  workspaceID: string;
}>;
export type ExecuteResult = Readonly<{
  planID: string;
  exportStatus: number;
  exportBytes: number;
  importStatus: number;
  importBytes: number;
  selected: MigrationSelection;
  imported: ImportedReceipt;
}> &
  ApiKeyStatus;
