import type { Envelope } from "../voiceflow/vf_contracts";

export const supportedPluginOperations = [
  "check-session",
  "list-workspaces",
  "list-projects",
  "list-versions",
  "list-folders",
  "plan-migration",
  "execute-migration",
] as const;

export type PluginOperation = (typeof supportedPluginOperations)[number];

export type PluginParameters = Readonly<Record<string, unknown>>;

export type NativePluginJob = Readonly<{
  readonly params: PluginParameters;
  readonly operation: PluginOperation;
}>;

export type VoiceflowEnvelope = Envelope<unknown>;

export type XYOpsPluginData = Readonly<{
  readonly voiceflow: VoiceflowEnvelope;
}>;

export type XYOpsPluginResponse = Readonly<{
  readonly xy: 1;
  readonly complete: true;
  readonly code: 0 | string;
  readonly data?: XYOpsPluginData;
  readonly description?: string;
}>;

export type PluginValidationCode =
  | "INVALID_JSON"
  | "INVALID_INPUT"
  | "MISSING_SECRET"
  | "UNKNOWN_OPERATION";

export class PluginValidationFault extends Error {
  constructor(
    public readonly code: PluginValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginValidationFault";
  }
}
