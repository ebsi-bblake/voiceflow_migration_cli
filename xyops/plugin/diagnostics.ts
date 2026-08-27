import type { PluginStage } from "./types";
export type { PluginStage } from "./types";

export const pluginStages = ["input", "secret", "dispatch", "response"] as const;

const maxDiagnosticLength = 320;
const maxErrorClassLength = 80;

type ReadErrorClass = (error: unknown) => string;
const readErrorName = (error: unknown): string => error instanceof Error ? error.name : "UnknownError";
const normalizeErrorName = (name: string): string => name.trim() === "" ? "UnknownError" : name;
const readErrorClass: ReadErrorClass = (error) => normalizeErrorName(readErrorName(error));

type ReadErrorMessage = (error: unknown) => string;
const readErrorText = (error: unknown): string => error instanceof Error ? error.message : "Unknown error";
const normalizeErrorText = (message: string): string => message.trim() === "" ? "Unknown error" : message;
const readErrorMessage: ReadErrorMessage = (error) => normalizeErrorText(readErrorText(error));

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
const isControlCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0);
  if (code <= 31) return true;
  return code === 127;
};
const sanitizeDiagnosticText: SanitizeDiagnosticText = (value, limit) =>
  redactSensitiveValues(removeStackLines(value))
    .split("").map((character) => isControlCharacter(character) ? " " : character).join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);

type FormatPluginDiagnostic = (stage: PluginStage, error: unknown) => string;
const fallbackDiagnosticValue = (value: string, fallback: string): string => {
  if (value === "") return fallback;
  return value;
};
export const formatPluginDiagnostic: FormatPluginDiagnostic = (stage, error) => {
  const errorClass = sanitizeDiagnosticText(
    readErrorClass(error),
    maxErrorClassLength,
  );
  const message = sanitizeDiagnosticText(readErrorMessage(error), maxDiagnosticLength);
  return `stage=${stage} error=${fallbackDiagnosticValue(errorClass, "UnknownError")} message=${fallbackDiagnosticValue(message, "Unknown error")}`
    .slice(0, maxDiagnosticLength);
};
