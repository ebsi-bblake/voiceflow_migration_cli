import { readSecretFile } from "../secrets";
import type { MigrationFileConfig } from "../config";
import type { SecretEntries } from "../types";
import type { PromptReader } from "../prompt";

type ReadSecretFileContents = (path: string) => Promise<SecretEntries | undefined>;
const readSecretFileContents: ReadSecretFileContents = (path) =>
  path === "" ? Promise.resolve(undefined) : readSecretFile(path);

type ReadSecretsForMigration = (
  reader: PromptReader,
  migrationConfig?: MigrationFileConfig,
) => Promise<SecretEntries | undefined>;
export const readSecretsForMigration: ReadSecretsForMigration = async (
  reader,
  migrationConfig,
) => {
  if (migrationConfig) return migrationConfig.secrets;
  const path = (await reader.ask("Secrets file path (leave blank to skip): ")).trim();
  return readSecretFileContents(path);
};
