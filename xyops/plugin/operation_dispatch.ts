import { main as checkSession } from "../voiceflow/vf_check_session";
import { main as executeMigration } from "../voiceflow/vf_execute_migration";
import { main as listFolders } from "../voiceflow/vf_list_folders";
import { main as listProjects } from "../voiceflow/vf_list_projects";
import { main as listVersions } from "../voiceflow/vf_list_versions";
import { main as listWorkspaces } from "../voiceflow/vf_list_workspaces";
import { main as planMigration } from "../voiceflow/vf_plan_migration";
import {
  failure,
  OperationFault,
  type Envelope,
} from "../voiceflow/vf_contracts";
import type { NativePluginJob } from "./contracts";
import { createUUID } from "../voiceflow/vf_uuid";

type PluginEnvelope = Envelope<unknown>;
type CheckSessionHandler = (token: string) => Promise<PluginEnvelope>;
type ListWorkspacesHandler = (token: string) => Promise<PluginEnvelope>;
type ListProjectsHandler = (token: string, sourceWorkspaceID: string) => Promise<PluginEnvelope>;
type ListVersionsHandler = (
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
) => Promise<PluginEnvelope>;
type ListFoldersHandler = (token: string, destinationWorkspaceID: string) => Promise<PluginEnvelope>;
type PlanMigrationHandler = (
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion?: string,
) => Promise<PluginEnvelope>;
type ExecuteMigrationHandler = (
  token: string,
  planID: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion?: string,
  confirmed?: boolean,
) => Promise<PluginEnvelope>;

export type OperationHandlers = Readonly<{
  readonly "check-session": CheckSessionHandler;
  readonly "list-workspaces": ListWorkspacesHandler;
  readonly "list-projects": ListProjectsHandler;
  readonly "list-versions": ListVersionsHandler;
  readonly "list-folders": ListFoldersHandler;
  readonly "plan-migration": PlanMigrationHandler;
  readonly "execute-migration": ExecuteMigrationHandler;
}>;

type DefaultOperationHandlers = OperationHandlers;
const defaultOperationHandlers: DefaultOperationHandlers = {
  "check-session": checkSession,
  "list-workspaces": listWorkspaces,
  "list-projects": listProjects,
  "list-versions": listVersions,
  "list-folders": listFolders,
  "plan-migration": planMigration,
  "execute-migration": executeMigration,
};

type RequiredParameter = (job: NativePluginJob, name: string) => string;
const requiredParameter: RequiredParameter = (job, name) => {
  const value = job.params[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return value.trim();
};

type OptionalParameter = (job: NativePluginJob, name: string) => string | undefined;
const optionalParameter: OptionalParameter = (job, name) => {
  const value = job.params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return value.trim();
};

type RequiredConfirmation = (job: NativePluginJob) => true;
const requiredConfirmation: RequiredConfirmation = (job) => {
  if (job.params.CONFIRMED !== true) {
    throw new OperationFault("CONFIRMATION_REQUIRED");
  }
  return true;
};

type InvokeOperation = (
  operation: NativePluginJob["operation"],
  invoke: () => Promise<PluginEnvelope>,
) => Promise<PluginEnvelope>;
const invokeOperation: InvokeOperation = (operation, invoke) =>
  Promise.resolve()
    .then(invoke)
    .catch((error: unknown) => failure(operation, createUUID(), error));

type DispatchOperation = (
  job: NativePluginJob,
  token: string,
  handlers?: OperationHandlers,
) => Promise<PluginEnvelope>;
export const dispatchOperation: DispatchOperation = (
  job,
  token,
  handlers = defaultOperationHandlers,
) => {
  try {
    switch (job.operation) {
      case "check-session":
        return invokeOperation(job.operation, () => handlers["check-session"](token));
      case "list-workspaces":
        return invokeOperation(job.operation, () => handlers["list-workspaces"](token));
      case "list-projects":
        return invokeOperation(job.operation, () =>
          handlers["list-projects"](token, requiredParameter(job, "SOURCE_WORKSPACE_ID")),
        );
      case "list-versions":
        return invokeOperation(job.operation, () =>
          handlers["list-versions"](
            token,
            requiredParameter(job, "SOURCE_WORKSPACE_ID"),
            requiredParameter(job, "SOURCE_PROJECT_ID"),
          ),
        );
      case "list-folders":
        return invokeOperation(job.operation, () =>
          handlers["list-folders"](token, requiredParameter(job, "DESTINATION_WORKSPACE_ID")),
        );
      case "plan-migration":
        return invokeOperation(job.operation, () =>
          handlers["plan-migration"](
            token,
            requiredParameter(job, "SOURCE_WORKSPACE_ID"),
            requiredParameter(job, "SOURCE_PROJECT_ID"),
            requiredParameter(job, "SOURCE_VERSION_ID"),
            requiredParameter(job, "DESTINATION_WORKSPACE_ID"),
            requiredParameter(job, "DESTINATION_FOLDER_ID"),
            optionalParameter(job, "TARGET_SCHEMA_VERSION"),
          ),
        );
      case "execute-migration":
        return invokeOperation(job.operation, () =>
          handlers["execute-migration"](
            token,
            requiredParameter(job, "PLAN_ID"),
            requiredParameter(job, "SOURCE_WORKSPACE_ID"),
            requiredParameter(job, "SOURCE_PROJECT_ID"),
            requiredParameter(job, "SOURCE_VERSION_ID"),
            requiredParameter(job, "DESTINATION_WORKSPACE_ID"),
            requiredParameter(job, "DESTINATION_FOLDER_ID"),
            optionalParameter(job, "TARGET_SCHEMA_VERSION"),
            requiredConfirmation(job),
          ),
        );
    }
  } catch (error: unknown) {
    return Promise.resolve(failure(job.operation, createUUID(), error));
  }
};
