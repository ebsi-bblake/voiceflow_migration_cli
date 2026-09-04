import { readSecretFile } from "../secrets";
import { fail } from "../diagnostics";
import type { MigrationFileConfig } from "../config";
import type { SecretEntries } from "../types";
import type { PromptReader } from "../prompt";
import { resolveConfiguredFilePath } from "../file-path";

export const resolveSecretsPath = resolveConfiguredFilePath;

type ReadSecretFileContents = (path: string) => Promise<SecretEntries | undefined>;
const readSecretFileContents: ReadSecretFileContents = (path) =>
  path === ""
    ? Promise.resolve(undefined)
    : readSecretFile(resolveConfiguredFilePath(path, process.platform)).catch(() => {
        throw fail("configuration", {
          nextAction: "The configured secrets file is invalid or unreadable.",
        });
      });

type ReadSecretsForMigration = (
  reader: PromptReader,
  migrationConfig?: MigrationFileConfig,
) => Promise<SecretEntries | undefined>;
export const readSecretsForMigration: ReadSecretsForMigration = async (
  reader,
  migrationConfig,
) => {
  if (migrationConfig !== undefined)
    return migrationConfig.secrets === undefined
      ? undefined
      : readSecretFileContents(migrationConfig.secrets);
  const path = (await reader.ask("Secrets file path (leave blank to skip): ")).trim();
  return readSecretFileContents(path);
};
