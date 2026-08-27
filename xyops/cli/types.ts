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
export type XYOpsResponse = Readonly<{
  code: number | string;
  description?: string;
  id?: string;
  job?: unknown;
  data?: unknown;
}>;
export type NativePluginResponse = Readonly<{
  xy: 1;
  complete: true;
  code: number | string;
  data: Readonly<{ voiceflow: unknown }>;
}>;
export type XYOpsLaunchResponse = XYOpsResponse & Readonly<{ id: string }>;
export type XYOpsJob = Readonly<{
  completed?: boolean | number | null;
  code: number | string;
  description?: string;
  output?: string | null;
  data?: unknown;
}>;
export type XYOpsJobResponse = XYOpsResponse & Readonly<{ job: XYOpsJob & Readonly<{ id: string }> }>;
export type XYOpsWaitJob = Readonly<{
  id: string;
  code: number | string;
  description?: string;
  output?: string | null;
  data?: unknown;
  completed?: boolean | number | null;
}>;
export type XYOpsWaitResponse = Readonly<{ code: number | string; description?: string; job: XYOpsWaitJob }>;
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
export type EventParameterValue = string | boolean;
export type EventParameters = Readonly<Record<string, EventParameterValue>>;
export type XYOpsEventConfig = Readonly<{
  checkSession: XYOpsEventReference;
  listWorkspaces: XYOpsEventReference;
  listProjects: XYOpsEventReference;
  listVersions: XYOpsEventReference;
  listFolders: XYOpsEventReference;
  planMigration: XYOpsEventReference;
  executeMigration: XYOpsEventReference;
}>;
export type XYOpsEventReference = string | Readonly<{ id: string }> | Readonly<{ title: string }>;
export type XYOpsConfig = Readonly<{
  baseURL: string;
  apiKey: string;
  events: XYOpsEventConfig;
  httpTimeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}>;
export type MigrationState = Readonly<{
  sourceWorkspaceID?: string;
  sourceProjectID?: string;
  sourceVersionID?: string;
  destinationWorkspaceID?: string;
  destinationFolderID?: string;
  targetSchemaVersion: string;
  planID?: string;
}>;
export type CliDiagnosticCode = "configuration" | "network" | "timeout" | "http" | "api" | "envelope" | "job" | "execute-outcome-unknown" | "invalid-input";
export type CliDiagnostic = Readonly<{
  code: CliDiagnosticCode;
  endpoint: string;
  retryable: boolean;
  status?: number;
  nextAction: string;
}>;
export type XYOpsClient = Readonly<{
  readEvent: <T>(eventReference: XYOpsEventReference, params: EventParameters, envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>) => Promise<VoiceflowEnvelope<T>>;
  executeEvent: <T>(eventReference: XYOpsEventReference, params: EventParameters, envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>) => Promise<VoiceflowEnvelope<T>>;
}>;
