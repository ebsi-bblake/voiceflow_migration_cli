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
import {
  createRunner,
  requireEnvironmentValue,
  type Runner,
} from "./runner_runtime";

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

type IsConfirmationGranted = (confirmed: unknown) => confirmed is true;
const isConfirmationGranted: IsConfirmationGranted = (confirmed) => {
  return confirmed === true;
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
  const operationID = crypto.randomUUID();
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

type ExecuteMigrationEnvelope = Awaited<ReturnType<typeof main>>;
type ExecuteMigrationRunner = Runner<ExecuteMigrationEnvelope>;

type ExecuteMigrationRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly PLAN_ID: string | undefined;
  readonly SOURCE_WORKSPACE_ID: string | undefined;
  readonly SOURCE_PROJECT_ID: string | undefined;
  readonly SOURCE_VERSION_ID: string | undefined;
  readonly DESTINATION_WORKSPACE_ID: string | undefined;
  readonly DESTINATION_FOLDER_ID: string | undefined;
  readonly TARGET_SCHEMA_VERSION: string | undefined;
  readonly CONFIRMED: string | undefined;
};

type ReadExecuteMigrationRequest = () => ExecuteMigrationRequest;
const readExecuteMigrationRequest: ReadExecuteMigrationRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  PLAN_ID: process.env.PLAN_ID,
  SOURCE_WORKSPACE_ID: process.env.SOURCE_WORKSPACE_ID,
  SOURCE_PROJECT_ID: process.env.SOURCE_PROJECT_ID,
  SOURCE_VERSION_ID: process.env.SOURCE_VERSION_ID,
  DESTINATION_WORKSPACE_ID: process.env.DESTINATION_WORKSPACE_ID,
  DESTINATION_FOLDER_ID: process.env.DESTINATION_FOLDER_ID,
  TARGET_SCHEMA_VERSION: process.env.TARGET_SCHEMA_VERSION,
  CONFIRMED: process.env.CONFIRMED,
});

type CreateExecuteMigrationRunner = () => ExecuteMigrationRunner;
export const createExecuteMigrationRunner: CreateExecuteMigrationRunner = () =>
  createRunner("execute-migration", () => {
    const request = readExecuteMigrationRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
      requireEnvironmentValue("PLAN_ID", request.PLAN_ID),
      requireEnvironmentValue(
        "SOURCE_WORKSPACE_ID",
        request.SOURCE_WORKSPACE_ID,
      ),
      requireEnvironmentValue("SOURCE_PROJECT_ID", request.SOURCE_PROJECT_ID),
      requireEnvironmentValue("SOURCE_VERSION_ID", request.SOURCE_VERSION_ID),
      requireEnvironmentValue(
        "DESTINATION_WORKSPACE_ID",
        request.DESTINATION_WORKSPACE_ID,
      ),
      requireEnvironmentValue(
        "DESTINATION_FOLDER_ID",
        request.DESTINATION_FOLDER_ID,
      ),
      request.TARGET_SCHEMA_VERSION,
      request.CONFIRMED === "true",
    );
  });
