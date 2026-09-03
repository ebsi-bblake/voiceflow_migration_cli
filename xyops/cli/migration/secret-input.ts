import { readSecretFile } from "../secrets";
import type { SecretEntries } from "../types";
import type { PromptReader } from "../prompt";

type ReadSecretFileContents = (path: string) => Promise<SecretEntries | undefined>;
const readSecretFileContents: ReadSecretFileContents = (path) =>
  path === "" ? Promise.resolve(undefined) : readSecretFile(path);

type ReadSecretsArgument = () => string | undefined;
const readSecretsArgument: ReadSecretsArgument = () =>
  process.argv.find((argument) => argument.startsWith("--secrets="))?.slice(10);

type ReadSecretsForMigration = (
  reader: PromptReader,
) => Promise<SecretEntries | undefined>;
export const readSecretsForMigration: ReadSecretsForMigration = async (
  reader,
) => {
  const argumentPath = readSecretsArgument();
  const path =
    argumentPath ??
    (await reader.ask("Secrets file path (leave blank to skip): ")).trim();
  return readSecretFileContents(path);
};
