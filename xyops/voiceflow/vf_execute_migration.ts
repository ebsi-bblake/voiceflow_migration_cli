import { resolveVoiceflowAuth } from "./vf_auth";
import { exportVersion } from "./vf_export";
import { importVersion } from "./vf_import";
import { retrieveApiKeyStatus } from "./vf_api_key";
import { buildMigrationPlan } from "./vf_planning";
import {
  failure,
  OperationFault,
  success,
} from "./vf_contracts";
import { isConfirmationGranted } from "./guards";
import type { Envelope, ExecuteResult, MigrationSelection, Warning } from "./types";
import { createUUID } from "./vf_uuid";

export type { ExecuteResult } from "./types";

type MigrationSelectionForArguments = (
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion: string,
) => MigrationSelection;
const migrationSelection: MigrationSelectionForArguments = (
  sourceWorkspaceID,
  sourceProjectID,
  sourceVersionID,
  destinationWorkspaceID,
  destinationFolderID,
  targetSchemaVersion,
) => {
  return {
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion,
  };
};

type ExecuteWarnings = (apiKeyRetrieved: boolean) => Warning[];
const executeWarnings: ExecuteWarnings = (apiKeyRetrieved) => {
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
};

type Main = (
  token: string,
  planID: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion?: string,
  confirmed?: boolean,
) => Promise<Envelope<ExecuteResult>>;
export const main: Main = async (
  token,
  planID,
  sourceWorkspaceID,
  sourceProjectID,
  sourceVersionID,
  destinationWorkspaceID,
  destinationFolderID,
  targetSchemaVersion = "13.1",
  confirmed = false,
) => {
  const operationID = createUUID();
  if (!isConfirmationGranted(confirmed)) {
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
