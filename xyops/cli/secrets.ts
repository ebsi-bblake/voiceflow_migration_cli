import { readFile } from "node:fs/promises";
import { parseSecretEntriesJSON } from "../voiceflow/vf_secrets";
import type { SecretEntry } from "./types";

type ReadSecretFile = (path: string) => Promise<readonly SecretEntry[]>;
export const readSecretFile: ReadSecretFile = (path) =>
  readFile(path, "utf8").then(parseSecretEntriesJSON);
