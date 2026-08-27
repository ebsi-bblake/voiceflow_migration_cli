export type {
  Envelope, ErrorCode, Failure, ImportedReceipt, MigrationPlan,
  MigrationSelection, OperationError, Success, Warning, WarningCode,
} from "./types";
import type {
  ErrorCode,
  Failure,
  OperationError,
  Success,
  Warning,
} from "./types";

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
