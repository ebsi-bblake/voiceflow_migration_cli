import { fail } from "./diagnostics";

export type Option = Readonly<{ value: string; label: string }>;
export type MigrationSelection = Readonly<{
  sourceWorkspaceID: string;
  sourceProjectID: string;
  sourceVersionID: string;
  destinationWorkspaceID: string;
  destinationFolderID: string;
  targetSchemaVersion: string;
}>;

export type MigrationPlan = Readonly<{
  planID: string;
  selection: MigrationSelection;
  labels: Readonly<{
    sourceWorkspace: string;
    sourceProject: string;
    sourceVersion: string;
    destinationWorkspace: string;
    destinationFolder: string;
  }>;
}>;

export type VoiceflowWarning = Readonly<{ code: string; message: string }>;
export type VoiceflowSuccess<T> = Readonly<{
  ok: true;
  operation: string;
  operationID: string;
  result: T;
  warnings: readonly VoiceflowWarning[];
}>;
export type VoiceflowFailure = Readonly<{
  ok: false;
  operation: string;
  operationID: string;
  error: Readonly<{ code: string; message: string; retryable: boolean }>;
}>;
export type VoiceflowEnvelope<T> = VoiceflowSuccess<T> | VoiceflowFailure;

export type ResponseGuard<T> = (value: unknown) => value is T;

type IsRecord = (value: unknown) => value is Readonly<Record<string, unknown>>;
const isRecord: IsRecord = (value): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type IsNonEmptyString = (value: unknown) => value is string;
const isNonEmptyString: IsNonEmptyString = (value): value is string =>
  typeof value === "string" && value.trim().length > 0;

type IsOption = (value: unknown) => value is Option;
export const isOption: IsOption = (value): value is Option =>
  isRecord(value) && isNonEmptyString(value.value) && isNonEmptyString(value.label);

type IsOptionResult = (value: unknown) => value is Readonly<{ options: readonly Option[] }>;
export const isOptionResult: IsOptionResult = (value): value is Readonly<{ options: readonly Option[] }> =>
  isRecord(value) && Array.isArray(value.options) && value.options.every(isOption);

type IsXYOpsResponse = (value: unknown) => value is XYOpsResponse;
export type XYOpsResponse = Readonly<{
  code: number | string;
  description?: string;
  id?: string;
  job?: unknown;
  data?: unknown;
}>;
export const isXYOpsResponse: IsXYOpsResponse = (value): value is XYOpsResponse =>
  isRecord(value) &&
  (typeof value.code === "number" || typeof value.code === "string") &&
  (!("description" in value) || typeof value.description === "string") &&
  (!("id" in value) || typeof value.id === "string");

export type XYOpsLaunchResponse = XYOpsResponse & Readonly<{ id: string }>;
type IsXYOpsLaunchResponse = (value: unknown) => value is XYOpsLaunchResponse;
export const isXYOpsLaunchResponse: IsXYOpsLaunchResponse = (value): value is XYOpsLaunchResponse =>
  isXYOpsResponse(value) && isNonEmptyString(value.id);

type IsJobLaunch = (value: unknown) => value is Readonly<{ id: string }>;
export const isJobLaunch: IsJobLaunch = (value): value is Readonly<{ id: string }> =>
  isRecord(value) && isNonEmptyString(value.id);

export type XYOpsJob = Readonly<{
  completed?: boolean | number;
  code: number | string;
  output?: string;
  data?: unknown;
}>;
type IsXYOpsJob = (value: unknown) => value is XYOpsJob;
export const isXYOpsJob: IsXYOpsJob = (value): value is XYOpsJob =>
  isRecord(value) &&
  (!("completed" in value) || typeof value.completed === "boolean" || typeof value.completed === "number") &&
  (typeof value.code === "number" || typeof value.code === "string") &&
  (!(("output" in value)) || typeof value.output === "string");

export type XYOpsJobResponse = XYOpsResponse & Readonly<{ job: XYOpsJob & Readonly<{ id: string }> }>;
type IsXYOpsJobResponse = (value: unknown) => value is XYOpsJobResponse;
export const isXYOpsJobResponse: IsXYOpsJobResponse = (value): value is XYOpsJobResponse =>
  isXYOpsResponse(value) &&
  isRecord(value.job) &&
  isNonEmptyString(value.job.id) &&
  isXYOpsJob(value.job);

export type XYOpsWaitJob = Readonly<{
  id: string;
  code: number | string;
  output?: string;
  data?: unknown;
  completed?: boolean | number;
}>;
type IsXYOpsWaitJob = (value: unknown) => value is XYOpsWaitJob;
export const isXYOpsWaitJob: IsXYOpsWaitJob = (value): value is XYOpsWaitJob =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  (typeof value.code === "number" || typeof value.code === "string") &&
  (!("output" in value) || typeof value.output === "string") &&
  (!("completed" in value) || typeof value.completed === "boolean" || typeof value.completed === "number");

export type XYOpsWaitResponse = Readonly<{
  code: number | string;
  description?: string;
  job: XYOpsWaitJob;
}>;
type IsXYOpsWaitResponse = (value: unknown) => value is XYOpsWaitResponse;
export const isXYOpsWaitResponse: IsXYOpsWaitResponse = (value): value is XYOpsWaitResponse =>
  isRecord(value) &&
  (typeof value.code === "number" || typeof value.code === "string") &&
  (!("description" in value) || typeof value.description === "string") &&
  isXYOpsWaitJob(value.job);

type IsVoiceflowEnvelope = <T>(
  resultGuard: ResponseGuard<T>,
) => ResponseGuard<VoiceflowEnvelope<T>>;
export const isVoiceflowEnvelope: IsVoiceflowEnvelope = <T>(resultGuard: ResponseGuard<T>) => (value): value is VoiceflowEnvelope<T> => {
  if (!isRecord(value) || !isNonEmptyString(value.operation) || !isNonEmptyString(value.operationID))
    return false;
  if (value.ok === true)
    return Array.isArray(value.warnings) &&
      value.warnings.every(isWarning) &&
      resultGuard(value.result);
  return value.ok === false && isFailure(value.error);
};

type IsWarning = (value: unknown) => value is VoiceflowWarning;
const isWarning: IsWarning = (value): value is VoiceflowWarning =>
  isRecord(value) && isNonEmptyString(value.code) && isNonEmptyString(value.message);

type IsFailure = (value: unknown) => value is VoiceflowFailure["error"];
const isFailure: IsFailure = (value): value is VoiceflowFailure["error"] =>
  isRecord(value) &&
  isNonEmptyString(value.code) &&
  typeof value.message === "string" &&
  typeof value.retryable === "boolean";

type RequireEnvelopeResult = <T>(
  value: unknown,
  operation: string,
  resultGuard: ResponseGuard<T>,
) => T;
export const requireEnvelopeResult: RequireEnvelopeResult = <T>(value: unknown, operation: string, resultGuard: ResponseGuard<T>) => {
  if (!isVoiceflowEnvelope(resultGuard)(value)) throw fail("envelope", { nextAction: `${operation} returned an invalid response.` });
  if (!value.ok) throw fail("envelope", { nextAction: `${operation} was rejected by the migration runner.` });
  return value.result;
};

type IsCheckSessionResult = (value: unknown) => value is Readonly<{ active: boolean }>;
export const isCheckSessionResult: IsCheckSessionResult = (value): value is Readonly<{ active: boolean }> =>
  isRecord(value) && typeof value.active === "boolean";

type IsMigrationPlan = (value: unknown) => value is MigrationPlan;
export const isMigrationPlan: IsMigrationPlan = (value): value is MigrationPlan => {
  if (!isRecord(value) || !isNonEmptyString(value.planID) || !isMigrationSelection(value.selection)) return false;
  const labels = value.labels;
  if (!isRecord(labels)) return false;
  return ["sourceWorkspace", "sourceProject", "sourceVersion", "destinationWorkspace", "destinationFolder"].every(
    (key) => isNonEmptyString(labels[key]),
  );
};

type IsMigrationSelection = (value: unknown) => value is MigrationSelection;
const isMigrationSelection: IsMigrationSelection = (value): value is MigrationSelection =>
  isRecord(value) &&
  ["sourceWorkspaceID", "sourceProjectID", "sourceVersionID", "destinationWorkspaceID", "destinationFolderID", "targetSchemaVersion"].every(
    (key) => isNonEmptyString(value[key]),
  );

export type ExecuteResult = Readonly<{
  planID: string;
  exportStatus: number;
  exportBytes: number;
  importStatus: number;
  importBytes: number;
  selected: MigrationSelection;
  imported: Readonly<{ projectID: string; [key: string]: unknown }>;
  apiKeyRetrieved: boolean;
}>;
type IsExecuteResult = (value: unknown) => value is ExecuteResult;
export const isExecuteResult: IsExecuteResult = (value): value is ExecuteResult => {
  if (!isRecord(value) || !isNonEmptyString(value.planID) || !isMigrationSelection(value.selected)) return false;
  if (!["exportStatus", "exportBytes", "importStatus", "importBytes"].every((key) => typeof value[key] === "number")) return false;
  if (typeof value.apiKeyRetrieved !== "boolean" || !isRecord(value.imported)) return false;
  return isNonEmptyString(value.imported.projectID);
};

export type EventParameters = Readonly<Record<string, string>>;
