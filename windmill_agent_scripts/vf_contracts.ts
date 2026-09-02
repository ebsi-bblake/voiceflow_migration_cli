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
export type Warning = { code: WarningCode; message: string };
export type OperationError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
};
export type Success<T> = {
  ok: true;
  operation: string;
  operationID: string;
  result: T;
  warnings: Warning[];
};
export type Failure = {
  ok: false;
  operation: string;
  operationID: string;
  error: OperationError;
};
export type Envelope<T> = Success<T> | Failure;
export type MigrationSelection = {
  sourceWorkspaceID: string;
  sourceProjectID: string;
  sourceVersionID: string;
  destinationWorkspaceID: string;
  destinationFolderID: string;
  targetSchemaVersion: string;
};
export type MigrationPlan = {
  planID: string;
  selection: MigrationSelection;
  labels: {
    sourceWorkspace: string;
    sourceProject: string;
    sourceVersion: string;
    destinationWorkspace: string;
    destinationFolder: string;
  };
};
export type SecretEntry = {
  name: string;
  value: string;
};
export type ImportedReceipt = {
  importStatus: number;
  importBytes: number;
  projectID: string;
  assistantID?: string;
  workspaceID?: string;
  folderID?: string;
};

const messages: Record<ErrorCode, string> = {
  INVALID_ARGUMENT: "The supplied arguments are invalid.",
  AUTHENTICATION_FAILED: "Authentication failed.",
  VOICEFLOW_LOGIN_REQUIRED: "Voiceflow login is required.",
  NOT_FOUND: "The requested Voiceflow resource was not found.",
  DEPENDENCY_TIMEOUT: "The Voiceflow dependency timed out.",
  DEPENDENCY_FAILURE: "The Voiceflow dependency failed.",
  PLAN_MISMATCH: "The migration plan does not match the requested operation.",
  CONFIRMATION_REQUIRED: "User confirmation is required before migration.",
  IMPORT_OUTCOME_UNKNOWN:
    "Import outcome is unknown; reconcile before retrying.",
  INTERNAL_ERROR: "The operation could not be completed.",
};

export class OperationFault extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly retryable = false,
  ) {
    super(messages[code]);
  }
}

export function toOperationError(error: unknown): OperationError {
  if (error instanceof OperationFault) {
    return {
      code: error.code,
      message: messages[error.code],
      retryable: error.retryable,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: messages.INTERNAL_ERROR,
    retryable: false,
  };
}

export function success<T>(
  operation: string,
  operationID: string,
  result: T,
  warnings: Warning[] = [],
): Success<T> {
  return { ok: true, operation, operationID, result, warnings };
}

export function failure(
  operation: string,
  operationID: string,
  error: unknown,
): Failure {
  return { ok: false, operation, operationID, error: toOperationError(error) };
}
