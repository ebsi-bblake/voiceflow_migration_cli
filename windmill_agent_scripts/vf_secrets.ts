/** Parses validated JSON secret entries at the Windmill input boundary. */
import { isRecord } from "./vf_guards";
import type { SecretEntry } from "./vf_contracts";

export function parseSecretEntries(value: unknown): SecretEntry[] {
  return typeof value === "string"
    ? parseSecretEntriesJSON(value)
    : parseSecretEntryArray(value);
}
function parseSecretEntryArray(value: unknown): SecretEntry[] {
  if (!Array.isArray(value))
    throw new Error("Secrets must be a JSON array of name/value entries.");
  const names = new Set<string>();
  return value.map((entryValue, index) => {
    if (!isRecord(entryValue) || Object.keys(entryValue).length !== 3)
      throw new Error(
        "Secret entries must contain only name, value, and type fields.",
      );
    if (typeof entryValue.name !== "string" || !entryValue.name.trim())
      throw new Error("Secret entries must contain a non-empty string name.");
    if (typeof entryValue.value !== "string")
      throw new Error("Secret entries must contain a string value.");
    if (
      entryValue.type !== "project" &&
      entryValue.type !== "secret" &&
      entryValue.type !== "url"
    )
      throw new Error(
        "Secret entries must contain type project, secret, or url.",
      );
    if (names.has(entryValue.name))
      throw new Error(
        `Secret entries contain duplicate name at index ${index}.`,
      );
    names.add(entryValue.name);
    return {
      name: entryValue.name,
      value: entryValue.value,
      type: entryValue.type,
    };
  });
}

function parseSecretEntriesJSON(contents: string): SecretEntry[] {
  return parseSecretEntries(JSON.parse(contents));
}
