import { resolveVoiceflowAuth } from "../vf_auth";
import { exportVersion } from "../vf_export";
import { importVersion } from "../vf_import";
import { retrieveApiKeyStatus } from "../vf_api_key";
import { buildMigrationPlan } from "../vf_planning";
import { failure, OperationFault, success } from "../vf_contracts";
import { isConfirmationGranted } from "../guards";
import type { Envelope, ExecuteResult } from "../types";
import { createUUID } from "../vf_uuid";
import { createProjectSecrets } from "../vf_logux";
import { parseSecretEntries } from "../vf_secrets";

export type { ExecuteResult } from "../types";

import { migrationSelection } from "./arguments";
import { executeWarnings } from "./warnings";

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
  secretFileContents?: unknown,
) => Promise<Envelope<ExecuteResult>>;
export const main: Main = async (
  token,
  planID,
  sourceWorkspaceID,
  sourceProjectID,
  sourceVersionID,
  destinationWorkspaceID,
  destinationFolderID,
  targetSchemaVersion,
  confirmed,
  secretFileContents,
) => {
  const operationID = createUUID();
  return isConfirmationGranted(normalizeConfirmation(confirmed))
    ? executeConfirmedMigration(
        token,
        planID,
        sourceWorkspaceID,
        sourceProjectID,
        sourceVersionID,
        destinationWorkspaceID,
        destinationFolderID,
        normalizeSchemaVersion(targetSchemaVersion),
        operationID,
        secretFileContents,
      )
    : failure(
        "execute-migration",
        operationID,
        new OperationFault("CONFIRMATION_REQUIRED"),
      );
};
const normalizeConfirmation = (confirmed: boolean | undefined): boolean =>
  confirmed ?? false;
const normalizeSchemaVersion = (version: string | undefined): string =>
  version ?? "13.1";

const executeConfirmedMigration = async (
  token: string,
  planID: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion: string,
  operationID: string,
  secretFileContents?: unknown,
): Promise<Envelope<ExecuteResult>> => {
  let stage = "authentication";
  try {
    const auth = await resolveVoiceflowAuth(token);
    stage = "planning";
    const selection = migrationSelection(
      sourceWorkspaceID,
      sourceProjectID,
      sourceVersionID,
      destinationWorkspaceID,
      destinationFolderID,
      targetSchemaVersion,
    );
    const plan = await buildMigrationPlan(auth, selection);
    ensureMatchingPlan(plan.planID, planID);
    stage = "export";
    const artifact = await exportVersion(auth, sourceVersionID);
    stage = "import";
    const imported = await importVersion(
      auth,
      artifact,
      destinationWorkspaceID,
      destinationFolderID,
      targetSchemaVersion,
    );
    stage = "secret-input";
    const secrets = parseSecretFileContents(secretFileContents);
    stage = "secret-creation";
    await createProjectSecrets(auth, imported.projectID, secrets);
    stage = "api-key-status";
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
    return failure("execute-migration", operationID, addFailureStage(error, stage));
  }
};
const addFailureStage = (error: unknown, stage: string): unknown =>
  error instanceof OperationFault
    ? error
    : new Error(`stage=${stage} error=${error instanceof Error ? error.message : String(error)}`);
const parseSecretFileContents = (contents: unknown) =>
  contents === undefined ? [] : parseSecretEntries(contents);
const ensureMatchingPlan = (
  actualPlanID: string,
  expectedPlanID: string,
): void => {
  if (actualPlanID !== expectedPlanID)
    throw new OperationFault("PLAN_MISMATCH");
};
