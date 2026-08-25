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
export type MigrationSelection = {
  readonly sourceWorkspaceID: string;
  readonly sourceProjectID: string;
  readonly sourceVersionID: string;
  readonly destinationWorkspaceID: string;
  readonly destinationFolderID: string;
  readonly targetSchemaVersion: string;
};
export type MigrationPlan = {
  readonly planID: string;
  readonly selection: MigrationSelection;
  readonly labels: Readonly<{
    sourceWorkspace: string;
    sourceProject: string;
    sourceVersion: string;
    destinationWorkspace: string;
    destinationFolder: string;
  }>;
};
export type ImportedReceipt = {
  readonly importStatus: number;
  readonly importBytes: number;
  readonly projectID: string;
  readonly assistantID?: string;
  readonly workspaceID?: string;
  readonly folderID?: string;
};

const messages: Readonly<Record<ErrorCode, string>> = {
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

type ToOperationError = (error: unknown) => OperationError;
export const toOperationError: ToOperationError = (error) => {
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
};

type SuccessEnvelope = <T>(
  operation: string,
  operationID: string,
  result: T,
  warnings?: readonly Warning[],
) => Success<T>;
export const success: SuccessEnvelope = (
  operation,
  operationID,
  result,
  warnings = [],
) => {
  return { ok: true, operation, operationID, result, warnings };
};

type FailureEnvelope = (
  operation: string,
  operationID: string,
  error: unknown,
) => Failure;
export const failure: FailureEnvelope = (operation, operationID, error) => {
  return { ok: false, operation, operationID, error: toOperationError(error) };
};
