export type {
  Envelope,
  ErrorCode,
  Failure,
  ImportedReceipt,
  MigrationPlan,
  MigrationSelection,
  OperationError,
  Success,
  Warning,
  WarningCode,
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

const maxDiagnosticLength = 240;
const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const safeUnexpectedErrorMessage = (error: unknown): string => {
  const sanitized = errorDetail(error)
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/VF\.DM\.[^\s"']+/gi, "VF.DM.[redacted]")
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxDiagnosticLength);
  if ([sanitized === "", containsSensitiveWord(sanitized)].some(Boolean)) {
    return `${messages.INTERNAL_ERROR} (${readFailureStage(sanitized)})`;
  }
  return `${messages.INTERNAL_ERROR} (${sanitized})`;
};
const readFailureStage = (value: string): string => {
  const match = value.match(/stage=[a-z-]+/i);
  return match?.[0] ?? "stage=unknown";
};

const containsSensitiveWord = (value: string): boolean =>
  /secret|token|password|credential|authorization|jwt/i.test(value);

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
    message: safeUnexpectedErrorMessage(error),
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
