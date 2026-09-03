import type { SecretEntry } from "./types";

export type { SecretEntry } from "./types";

type ParseSecretsFile = (contents: string) => readonly SecretEntry[];
export const parseSecretsFile: ParseSecretsFile = (contents) =>
  parseSecretEntriesJSON(contents);

type ParseSecretEntries = (value: unknown) => readonly SecretEntry[];
export const parseSecretEntries: ParseSecretEntries = (value) =>
  typeof value === "string"
    ? parseSecretEntriesJSON(value)
    : parseSecretEntryArray(value);

const parseSecretEntryArray = (value: unknown): readonly SecretEntry[] => {
  if (!Array.isArray(value))
    throw new Error("Secrets must be a JSON array of name/value entries.");
  const names = new Set<string>();
  return value.map((entry, index) => {
    const secret = parseSecretEntry(entry);
    if (names.has(secret.name))
      throw new Error(`Secret entries contain duplicate name at index ${index}.`);
    names.add(secret.name);
    return secret;
  });
};

const parseSecretEntry = (value: unknown): SecretEntry => {
  if (!isRecord(value) || Object.keys(value).length !== 2)
    throw new Error("Secret entries must contain only name and value fields.");
  if (typeof value.name !== "string")
    throw new Error("Secret entries must contain a string name.");
  if (typeof value.value !== "string")
    throw new Error("Secret entries must contain a string value.");
  return { name: value.name, value: value.value };
};
type ParseSecretEntriesJSON = (contents: string) => readonly SecretEntry[];
export const parseSecretEntriesJSON: ParseSecretEntriesJSON = (contents) =>
  parseSecretEntries(JSON.parse(contents));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  [value !== null, typeof value === "object", !Array.isArray(value)].every(
    Boolean,
  );
