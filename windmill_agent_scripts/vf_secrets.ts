/** Parses validated JSON secret entries at the Windmill input boundary. */
import { isRecord } from "./vf_guards";
import type { SecretEntry } from "./vf_contracts";

export function parseSecretEntries(value: unknown): SecretEntry[] {
  return typeof value === "string"
    ? parseSecretEntriesJSON(value)
    : parseSecretMap(value);
}
function parseSecretMap(value: unknown): SecretEntry[] {
  if (!isRecord(value)) throw new Error("Secrets must be a JSON object.");
  return Object.entries(value).map(([name, entryValue]) => {
    if (typeof entryValue !== "string")
      throw new Error("Secret values must be strings.");
    return { name, value: entryValue };
  });
}

function parseSecretEntriesJSON(contents: string): SecretEntry[] {
  return parseSecretEntries(JSON.parse(contents));
}

