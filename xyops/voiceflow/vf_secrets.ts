import type { SecretEntry } from "./types";

export type { SecretEntry } from "./types";

type ParseSecretsFile = (contents: string) => readonly SecretEntry[];
export const parseSecretsFile: ParseSecretsFile = (contents) =>
  contents
    .split(/\r?\n/)
    .map(normalizeSecretLine)
    .filter(isSecretLine)
    .map(parseSecretLine);

type ParseSecretEntries = (value: unknown) => readonly SecretEntry[];
export const parseSecretEntries: ParseSecretEntries = (value) =>
  typeof value === "string"
    ? parseSecretEntriesJSON(value)
    : Array.isArray(value)
      ? parseSecretEntryList(value)
      : parseSecretMap(value);
const parseSecretMap = (value: unknown): readonly SecretEntry[] => {
  if (!isRecord(value)) throw new Error("Secrets must be a JSON object.");
  return Object.entries(value).map(parseSecretEntry);
};
const parseSecretEntryList = (value: readonly unknown[]): readonly SecretEntry[] =>
  value.map(parseSecretListItem);
const parseSecretListItem = (value: unknown): SecretEntry => {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.value !== "string")
    throw new Error("Secret entries must contain string name and value fields.");
  return { name: value.name, value: value.value };
};
const parseSecretEntry = ([name, entryValue]: readonly [string, unknown]): SecretEntry => {
  if (typeof entryValue !== "string")
    throw new Error("Secret values must be strings.");
  return { name, value: entryValue };
};
type ParseSecretEntriesJSON = (contents: string) => readonly SecretEntry[];
export const parseSecretEntriesJSON: ParseSecretEntriesJSON = (contents) =>
  parseSecretEntries(JSON.parse(contents));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  [value !== null, typeof value === "object", !Array.isArray(value)].every(Boolean);

const normalizeSecretLine = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.startsWith("export ")) return trimmed.slice(7).trim();
  return trimmed;
};
const isSecretLine = (line: string): boolean =>
  [line !== "", !line.startsWith("#"), line.includes("=")].every(Boolean);
const parseSecretLine = (line: string): SecretEntry => {
  const separator = line.indexOf("=");
  const name = line.slice(0, separator).trim();
  const rawValue = line.slice(separator + 1).trim();
  if (!isValidSecretName(name)) throw invalidSecretName(name);
  return { name, value: unquoteSecretValue(rawValue) };
};
const isValidSecretName = (name: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
const invalidSecretName = (name: string): Error =>
  new Error(`Invalid secret name: ${name || "<empty>"}`);
const isQuotedSecretValue = (value: string): boolean =>
  /^(".*"|'.*')$/u.test(value);
const unquoteLongSecretValue = (value: string): string =>
  isQuotedSecretValue(value) ? value.slice(1, -1) : value;
const unquoteSecretValue = (value: string): string =>
  value.length < 2 ? value : unquoteLongSecretValue(value);
