import { buildMigrationPlan } from "./vf_planning";
import { resolveVoiceflowAuth } from "./vf_auth";
import { success, failure, type MigrationSelection } from "./vf_contracts";
import type { Envelope, MigrationPlan } from "./vf_contracts";
import {
  createRunner,
  requireEnvironmentValue,
  type Runner,
} from "./runner_runtime";

type BuildPlanForSelection = (
  selection: MigrationSelection,
) => (
  auth: Parameters<typeof buildMigrationPlan>[0],
) => ReturnType<typeof buildMigrationPlan>;
const buildPlanForSelection: BuildPlanForSelection = (selection) => (auth) =>
  buildMigrationPlan(auth, selection);

type Main = (
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion?: string,
) => Promise<Envelope<MigrationPlan>>;
export const main: Main = (
  token,
  sourceWorkspaceID,
  sourceProjectID,
  sourceVersionID,
  destinationWorkspaceID,
  destinationFolderID,
  targetSchemaVersion = "13.1",
) => {
  const id = crypto.randomUUID();
  const selection: MigrationSelection = {
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion,
  };
  return resolveVoiceflowAuth(token)
    .then(buildPlanForSelection(selection))
    .then((plan) => success("plan-migration", id, plan))
    .catch((error) => failure("plan-migration", id, error));
};

type PlanMigrationEnvelope = Awaited<ReturnType<typeof main>>;
type PlanMigrationRunner = Runner<PlanMigrationEnvelope>;

type PlanMigrationRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly SOURCE_WORKSPACE_ID: string | undefined;
  readonly SOURCE_PROJECT_ID: string | undefined;
  readonly SOURCE_VERSION_ID: string | undefined;
  readonly DESTINATION_WORKSPACE_ID: string | undefined;
  readonly DESTINATION_FOLDER_ID: string | undefined;
  readonly TARGET_SCHEMA_VERSION: string | undefined;
};

type ReadPlanMigrationRequest = () => PlanMigrationRequest;
const readPlanMigrationRequest: ReadPlanMigrationRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  SOURCE_WORKSPACE_ID: process.env.SOURCE_WORKSPACE_ID,
  SOURCE_PROJECT_ID: process.env.SOURCE_PROJECT_ID,
  SOURCE_VERSION_ID: process.env.SOURCE_VERSION_ID,
  DESTINATION_WORKSPACE_ID: process.env.DESTINATION_WORKSPACE_ID,
  DESTINATION_FOLDER_ID: process.env.DESTINATION_FOLDER_ID,
  TARGET_SCHEMA_VERSION: process.env.TARGET_SCHEMA_VERSION,
});

type CreatePlanMigrationRunner = () => PlanMigrationRunner;
export const createPlanMigrationRunner: CreatePlanMigrationRunner = () =>
  createRunner("plan-migration", () => {
    const request = readPlanMigrationRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
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
    );
  });
