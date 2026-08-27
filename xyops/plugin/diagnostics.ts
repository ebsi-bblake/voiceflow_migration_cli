export const pluginStages = ["input", "secret", "dispatch", "response"] as const;
export type PluginStage = (typeof pluginStages)[number];

const maxDiagnosticLength = 320;
const maxErrorClassLength = 80;

type ReadErrorClass = (error: unknown) => string;
const readErrorClass: ReadErrorClass = (error) =>
  error instanceof Error && error.name.trim() !== ""
    ? error.name
    : "UnknownError";

type ReadErrorMessage = (error: unknown) => string;
const readErrorMessage: ReadErrorMessage = (error) =>
  error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "Unknown error";

type RemoveStackLines = (message: string) => string;
const removeStackLines: RemoveStackLines = (message) =>
  message
    .split(/\r?\n/u)
    .filter((line) => !/^\s*at\s+/u.test(line))
    .join(" ");

type RedactSensitiveValues = (message: string) => string;
const redactSensitiveValues: RedactSensitiveValues = (message) =>
  message
    .replace(/\bBearer\s+[^\s,;}]+/giu, "Bearer [REDACTED]")
    .replace(
      /\b(?:eyJ[A-Za-z0-9_-]{4,}\.)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
      "[REDACTED_JWT]",
    )
    .replace(
      /(["']?(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|password|secret|token|jwt)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;}\s]+)/giu,
      "$1[REDACTED]",
    )
    .replace(
      /(["']?(?:params?|payload|export(?:ed)?(?:data|base64)?)["']?\s*[:=]\s*)(?:\{[^\n]*\}|\[[^\n]*\]|[^,;}\s]+)/giu,
      "$1[REDACTED_DATA]",
    )
    .replace(/\{[^\n]*\}|\[[^\n]*\]/gu, "[REDACTED_DATA]")
    .replace(/\b(?:jwt|token|api[ _-]?key|sk|pk|vf)[_-][A-Za-z0-9_-]+\b/giu, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/gu, "[REDACTED]");

type SanitizeDiagnosticText = (value: string, limit: number) => string;
const sanitizeDiagnosticText: SanitizeDiagnosticText = (value, limit) =>
  redactSensitiveValues(removeStackLines(value))
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);

type FormatPluginDiagnostic = (stage: PluginStage, error: unknown) => string;
export const formatPluginDiagnostic: FormatPluginDiagnostic = (stage, error) => {
  const errorClass = sanitizeDiagnosticText(
    readErrorClass(error),
    maxErrorClassLength,
  );
  const message = sanitizeDiagnosticText(readErrorMessage(error), maxDiagnosticLength);
  return `stage=${stage} error=${errorClass || "UnknownError"} message=${message || "Unknown error"}`
    .slice(0, maxDiagnosticLength);
};
