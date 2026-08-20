export type MigrationPhase =
  | "Authentication"
  | "Catalog"
  | "Export"
  | "Import"
  | "API-key retrieval";
export type MigrationEndpoint =
  | "voiceflow"
  | "identity"
  | "catalog"
  | "unknown";
export type MigrationCode =
  | "invalid-input"
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "rate-limited"
  | "server-error"
  | "network-error"
  | "timeout"
  | "response-too-large"
  | "read-failure"
  | "invalid-json"
  | "invalid-import-receipt"
  | "api-key-missing"
  | "api-key-ambiguous"
  | "unknown";
export type MigrationDiagnostic = {
  readonly phase: MigrationPhase;
  readonly endpoint: MigrationEndpoint;
  readonly code: MigrationCode;
  readonly retryable: boolean;
  readonly diagnosticId: string;
  readonly nextAction: string;
  readonly status?: number;
  readonly contentType?: string;
  readonly responseSize?: number;
  readonly requestId?: string;
};
const safe = (value: string): string =>
  value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);

function createDiagnostic(
  phase: MigrationPhase,
  code: MigrationCode,
  options: Partial<Omit<MigrationDiagnostic, "phase" | "code" | "diagnosticId">>,
): MigrationDiagnostic {
  const retryable =
    options.retryable ??
    ["rate-limited", "server-error", "network-error", "timeout"].includes(code);
  const action =
    options.nextAction ??
    (retryable
      ? "Retry the operation."
      : "Check the migration inputs and response.");

  return {
    ...options,
    phase,
    code,
    endpoint: options.endpoint ?? "unknown",
    retryable,
    diagnosticId: crypto.randomUUID(),
    nextAction: safe(action),
  };
}

export class MigrationError extends Error {
  constructor(readonly diagnostic: MigrationDiagnostic) {
    super(diagnostic.code);
    this.name = "MigrationError";
  }
}
export function codeForStatus(status: number): MigrationCode {
  if (status === 401 || status === 403)
    return status === 401 ? "authentication-failed" : "permission-denied";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  return status >= 500 ? "server-error" : "unknown";
}
export function diagnostic(
  phase: MigrationPhase,
  code: MigrationCode,
  options: Partial<
    Omit<MigrationDiagnostic, "phase" | "code" | "diagnosticId">
  > = {},
): MigrationError {
  return new MigrationError(createDiagnostic(phase, code, options));
}
export function asMigrationError(
  error: unknown,
  phase: MigrationPhase = "Import",
): MigrationError {
  return error instanceof MigrationError ? error : diagnostic(phase, "unknown");
}
