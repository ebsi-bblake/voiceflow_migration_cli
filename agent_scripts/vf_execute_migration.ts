import { resolveVoiceflowAuth } from "./vf_auth";
import { exportVersion } from "./vf_export";
import { importVersion } from "./vf_import";
import { retrieveApiKeyStatus, type ApiKeyStatus } from "./vf_api_key";
import { buildMigrationPlan } from "./vf_planning";
import {
  failure,
  OperationFault,
  success,
  type Envelope,
  type MigrationSelection,
  type Warning,
} from "./vf_contracts";

export type ExecuteResult = {
  planID: string;
  exportStatus: number;
  exportBytes: number;
  importStatus: number;
  importBytes: number;
  selected: MigrationSelection;
  imported: Awaited<ReturnType<typeof importVersion>>;
  apiKeyRetrieved: boolean;
  postImport?: ApiKeyStatus["postImport"];
};

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
): Promise<Envelope<ExecuteResult>> {
  const operationID = crypto.randomUUID();
  if (!confirmed) {
    return failure(
      "execute-migration",
      operationID,
      new OperationFault("CONFIRMATION_REQUIRED"),
    );
  }
  try {
    const auth = await resolveVoiceflowAuth(token);
    const selection = migrationSelection(
      sourceWorkspaceID,
      sourceProjectID,
      sourceVersionID,
      destinationWorkspaceID,
      destinationFolderID,
      targetSchemaVersion,
    );
    const plan = await buildMigrationPlan(auth, selection);
    if (plan.planID !== planID) {
      return failure(
        "execute-migration",
        operationID,
        new OperationFault("PLAN_MISMATCH"),
      );
    }
    const artifact = await exportVersion(auth, sourceVersionID);
    const imported = await importVersion(
      auth,
      artifact,
      destinationWorkspaceID,
      destinationFolderID,
      targetSchemaVersion,
    );
    const apiKey = await retrieveApiKeyStatus(auth, imported.projectID);
    const result: ExecuteResult = {
      planID,
      exportStatus: artifact.status,
      exportBytes: artifact.bytes.byteLength,
      importStatus: imported.importStatus,
      importBytes: imported.importBytes,
      selected: plan.selection,
      imported,
      apiKeyRetrieved: apiKey.apiKeyRetrieved,
      postImport: apiKey.postImport,
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
