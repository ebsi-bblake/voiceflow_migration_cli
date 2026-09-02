import { readFile } from "node:fs/promises";
import { parseSecretEntriesJSON } from "../voiceflow/vf_secrets";
import type { SecretMap } from "./types";

type ReadSecretFile = (path: string) => Promise<SecretMap>;
export const readSecretFile: ReadSecretFile = (path) =>
  readFile(path, "utf8").then(parseSecretEntriesJSON).then(secretMap); 
const secretMap = (
  entries: readonly { name: string; value: string }[],
): SecretMap => Object.fromEntries(entries.map(({ name, value }) => [name, value]));
