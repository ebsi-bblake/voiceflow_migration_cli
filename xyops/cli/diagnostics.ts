export type CliDiagnosticCode =
  | "configuration"
  | "network"
  | "timeout"
  | "http"
  | "api"
  | "envelope"
  | "job"
  | "execute-outcome-unknown"
  | "invalid-input";

export type CliDiagnostic = Readonly<{
  code: CliDiagnosticCode;
  endpoint: string;
  retryable: boolean;
  status?: number;
  nextAction: string;
}>;

type SafeEndpoint = (endpoint: string) => string;
const safeEndpoint: SafeEndpoint = (endpoint) =>
  endpoint.replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 80) || "xyops";

type CreateCliError = (
  diagnostic: Omit<CliDiagnostic, "endpoint"> & { endpoint?: string },
) => CliError;
const createCliError: CreateCliError = (diagnostic) =>
  new CliError({
    ...diagnostic,
    endpoint: safeEndpoint(diagnostic.endpoint ?? "xyops"),
  });

export class CliError extends Error {
  constructor(readonly diagnostic: CliDiagnostic) {
    super(diagnostic.code);
    this.name = "CliError";
  }
}

type DiagnosticOptions = Readonly<{
  endpoint?: string;
  retryable?: boolean;
  status?: number;
  nextAction?: string;
}>;

type Fail = (
  code: CliDiagnosticCode,
  options?: DiagnosticOptions,
) => CliError;
export const fail: Fail = (code, options = {}) =>
  createCliError({
    code,
    endpoint: options.endpoint,
    retryable: options.retryable ?? false,
    status: options.status,
    nextAction:
      options.nextAction ??
      (options.retryable ? "Retry the operation." : "Check configuration and migration inputs."),
  });

type AsCliError = (error: unknown) => CliError;
export const asCliError: AsCliError = (error) =>
  error instanceof CliError ? error : fail("network", { retryable: false });

type CliErrorOutput = (error: unknown) => Readonly<Record<string, unknown>>;
export const cliErrorOutput: CliErrorOutput = (error) => {
  const diagnostic = asCliError(error).diagnostic;
  return {
    code: diagnostic.code,
    endpoint: diagnostic.endpoint,
    retryable: diagnostic.retryable,
    ...(diagnostic.status === undefined ? {} : { status: diagnostic.status }),
    nextAction: diagnostic.nextAction,
  };
};
