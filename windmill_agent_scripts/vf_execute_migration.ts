import { resolveVoiceflowAuth } from "./vf_auth";
import { exportVersion } from "./vf_export";
import { importVersion } from "./vf_import";
import { retrieveApiKeyStatus, type ApiKeyStatus } from "./vf_api_key";
import { buildMigrationPlan } from "./vf_planning";
import { createProjectSecrets } from "./vf_logux";
import { parseSecretEntries } from "./vf_secrets";
import {
  failure,
  OperationFault,
  success,
  type Envelope,
  type MigrationSelection,
  type Warning,
  type SecretEntry,
} from "./vf_contracts";

type ExecuteResultBase = {
  planID: string;
  exportStatus: number;
  exportBytes: number;
  importStatus: number;
  importBytes: number;
  selected: MigrationSelection;
  imported: Awaited<ReturnType<typeof importVersion>>;
};
export type ExecuteResult = ExecuteResultBase & ApiKeyStatus;

function migrationSelection(
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion: string,
): MigrationSelection {
  return {
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion,
  };
}

function executeWarnings(apiKeyRetrieved: boolean): Warning[] {
  const warnings: Warning[] = [
    {
      code: "NOT_IDEMPOTENT",
      message: "Import is not idempotent; do not retry blindly.",
    },
  ];
  if (!apiKeyRetrieved) {
    warnings.push({
      code: "API_KEY_RETRIEVAL_FAILED",
      message: "Project API key could not be retrieved.",
    });
  }
  return warnings;
}

function isConfirmationGranted(confirmed: unknown): confirmed is true {
  return confirmed === true;
}

function getSecrets(input: ExecuteMigrationInput): SecretEntry[] {
  return input.secretFileContents === undefined
    ? []
    : parseSecretEntries(input.secretFileContents);
}

type ExecuteMigrationInput = Readonly<{
  token: string;
  planID: string;
  sourceWorkspaceID: string;
  sourceProjectID: string;
  sourceVersionID: string;
  destinationWorkspaceID: string;
  destinationFolderID: string;
  targetSchemaVersion: string;
  secretFileContents?: unknown;
}>;

async function executeMigration(
  input: ExecuteMigrationInput,
  operationID: string,
): Promise<Envelope<ExecuteResult>> {
  try {
    const auth = await resolveVoiceflowAuth(input.token);
    const selection = migrationSelection(
      input.sourceWorkspaceID,
      input.sourceProjectID,
      input.sourceVersionID,
      input.destinationWorkspaceID,
      input.destinationFolderID,
      input.targetSchemaVersion,
    );
    const plan = await buildMigrationPlan(auth, selection);
    requireMatchingPlan(plan.planID, input.planID);
    const artifact = await exportVersion(auth, input.sourceVersionID);
    const imported = await importVersion(
      auth,
      artifact,
      input.destinationWorkspaceID,
      input.destinationFolderID,
      input.targetSchemaVersion,
    );
    const secrets = getSecrets(input);
    await createProjectSecrets(auth, imported.projectID, secrets);
    const apiKey = await retrieveApiKeyStatus(auth, imported.projectID);
    const result: ExecuteResult = {
      planID: input.planID,
      exportStatus: artifact.status,
      exportBytes: artifact.bytes.byteLength,
      importStatus: imported.importStatus,
      importBytes: imported.importBytes,
      selected: plan.selection,
      imported,
      ...apiKey,
    };
    return success(
      "execute-migration",
      operationID,
      result,
      executeWarnings(apiKey.apiKeyRetrieved),
    );
  } catch (error) {
    return failure("execute-migration", operationID, error);
  }
}

function requireMatchingPlan(
  actualPlanID: string,
  expectedPlanID: string,
): void {
  if (actualPlanID !== expectedPlanID)
    throw new OperationFault("PLAN_MISMATCH");
}

// Defaulted public arguments are part of the deployed Windmill contract.
export async function main(
  token: string,
  planID: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion = "13.1",
  confirmed = false,
  secretFileContents?: unknown,
): Promise<Envelope<ExecuteResult>> {
  const operationID = crypto.randomUUID();
  const input = {
    token,
    planID,
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion,
    secretFileContents,
  };
  return isConfirmationGranted(confirmed)
    ? executeMigration(input, operationID)
    : failure(
        "execute-migration",
        operationID,
        new OperationFault("CONFIRMATION_REQUIRED"),
      );
}
