import { resolveVoiceflowAuth } from "../vf_auth";
import { exportVersion } from "../vf_export";
import { importVersion } from "../vf_import";
import { retrieveApiKeyStatus } from "../vf_api_key";
import { buildMigrationPlan } from "../vf_planning";
import {
  failure,
  OperationFault,
  success,
} from "../vf_contracts";
import { isConfirmationGranted } from "../guards";
import type { Envelope, ExecuteResult } from "../types";
import { createUUID } from "../vf_uuid";

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
) => {
  const operationID = createUUID();
  return isConfirmationGranted(normalizeConfirmation(confirmed))
    ? executeConfirmedMigration(
    token, planID, sourceWorkspaceID, sourceProjectID, sourceVersionID,
    destinationWorkspaceID, destinationFolderID, normalizeSchemaVersion(targetSchemaVersion), operationID,
      )
    : failure("execute-migration", operationID, new OperationFault("CONFIRMATION_REQUIRED"));
};
const normalizeConfirmation = (confirmed: boolean | undefined): boolean => confirmed ?? false;
const normalizeSchemaVersion = (version: string | undefined): string => version ?? "13.1";

const executeConfirmedMigration = async (
  token: string, planID: string, sourceWorkspaceID: string, sourceProjectID: string,
  sourceVersionID: string, destinationWorkspaceID: string, destinationFolderID: string,
  targetSchemaVersion: string, operationID: string,
): Promise<Envelope<ExecuteResult>> => {
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
    ensureMatchingPlan(plan.planID, planID);
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
};
const ensureMatchingPlan = (actualPlanID: string, expectedPlanID: string): void => {
  if (actualPlanID !== expectedPlanID) throw new OperationFault("PLAN_MISMATCH");
};
