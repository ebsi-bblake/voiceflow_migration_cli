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
import { createUUID } from "../voiceflow/vf_uuid";
import type { NativePluginJob, OperationHandlers } from "./types";
import { parseSecretEntries } from "../voiceflow/vf_secrets";
import type { SecretEntry } from "../voiceflow/types";
export type { OperationHandlers } from "./types";

type PluginEnvelope = Envelope<unknown>;
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

type TrimParameter = (value: unknown) => string;
const requireParameterString = (value: unknown): string => {
  if (typeof value !== "string") throw new OperationFault("INVALID_ARGUMENT");
  return value;
};
const trimParameter: TrimParameter = (value) => {
  const stringValue = requireParameterString(value);
  if (stringValue.trim() === "") throw new OperationFault("INVALID_ARGUMENT");
  return stringValue.trim();
};
type RequiredParameter = (job: NativePluginJob, name: string) => string;
const requiredParameter: RequiredParameter = (job, name) =>
  trimParameter(job.params[name]);
type OptionalParameter = (
  job: NativePluginJob,
  name: string,
) => string | undefined;
const optionalParameter: OptionalParameter = (job, name) => {
  const value = job.params[name];
  if (value === undefined) return undefined;
  return trimParameter(value);
};
type OptionalSecretEntries = (
  job: NativePluginJob,
  name: string,
) => readonly SecretEntry[] | undefined;
const optionalSecretEntries: OptionalSecretEntries = (job, name) => {
  const value = job.params[name];
  return value === undefined ? undefined : parseSecretEntries(value);
};
type RequiredConfirmation = (job: NativePluginJob) => true;
const requiredConfirmation: RequiredConfirmation = (job) => {
  if (job.params.CONFIRMED !== true)
    throw new OperationFault("CONFIRMATION_REQUIRED");
  return true;
};
type OperationInvocation = (
  job: NativePluginJob,
  token: string,
  handlers: OperationHandlers,
) => Promise<PluginEnvelope>;
type OperationInvocations = Readonly<
  Record<NativePluginJob["operation"], OperationInvocation>
>;
const operationInvocations: OperationInvocations = {
  "check-session": (_job, token, handlers) => handlers["check-session"](token),
  "list-workspaces": (_job, token, handlers) =>
    handlers["list-workspaces"](token),
  "list-projects": (job, token, handlers) =>
    handlers["list-projects"](
      token,
      requiredParameter(job, "SOURCE_WORKSPACE_ID"),
    ),
  "list-versions": (job, token, handlers) =>
    handlers["list-versions"](
      token,
      requiredParameter(job, "SOURCE_WORKSPACE_ID"),
      requiredParameter(job, "SOURCE_PROJECT_ID"),
    ),
  "list-folders": (job, token, handlers) =>
    handlers["list-folders"](
      token,
      requiredParameter(job, "DESTINATION_WORKSPACE_ID"),
    ),
  "plan-migration": (job, token, handlers) =>
    handlers["plan-migration"](
      token,
      requiredParameter(job, "SOURCE_WORKSPACE_ID"),
      requiredParameter(job, "SOURCE_PROJECT_ID"),
      requiredParameter(job, "SOURCE_VERSION_ID"),
      requiredParameter(job, "DESTINATION_WORKSPACE_ID"),
      requiredParameter(job, "DESTINATION_FOLDER_ID"),
      optionalParameter(job, "TARGET_SCHEMA_VERSION"),
    ),
  "execute-migration": (job, token, handlers) =>
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
      optionalSecretEntries(job, "SECRET_FILE_CONTENTS"),
    ),
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
) =>
  invokeOperation(job.operation, () =>
    operationInvocations[job.operation](job, token, handlers),
  );
