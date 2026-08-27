import {
  PluginValidationFault,
} from "./validation_fault";
import { isNonEmptyString, isPluginOperation, isRecord } from "./guards";
import type { NativePluginJob, PluginOperation, PluginParameters } from "./types";
export { isPluginOperation } from "./guards";

type SelectOperation = (params: PluginParameters) => PluginOperation;
const selectOperation: SelectOperation = (params) => {
  const selected = params.operation;
  if (!isNonEmptyString(selected)) {
    throw new PluginValidationFault(
      "INVALID_INPUT",
      "An operation parameter is required.",
    );
  }
  if (!isPluginOperation(selected)) {
    throw new PluginValidationFault(
      "UNKNOWN_OPERATION",
      "The requested operation is not supported.",
    );
  }
  return selected;
};

type ValidatePluginJob = (value: unknown) => NativePluginJob;
export const validatePluginJob: ValidatePluginJob = (value) => {
  if (
    !isRecord(value) ||
    value.xy !== 1 ||
    value.type !== "event" ||
    !isRecord(value.params)
  ) {
    throw new PluginValidationFault(
      "INVALID_INPUT",
      "The plugin input must be an XYOps event job with object-valued params.",
    );
  }
  const params = value.params;
  const operation = selectOperation(params);
  return { params, operation };
};

type ParsePluginJob = (input: string) => NativePluginJob;
export const parsePluginJob: ParsePluginJob = (input) => {
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    throw new PluginValidationFault(
      "INVALID_JSON",
      "The event job is not valid JSON.",
    );
  }
  return validatePluginJob(value);
};

type ReadVoiceflowJWT = (
  environment: Readonly<Record<string, string | undefined>>,
) => string;
export const readVoiceflowJWT: ReadVoiceflowJWT = (environment) => {
  const environmentSecret = environment.VOICEFLOW_JWT;
  if (isNonEmptyString(environmentSecret)) return environmentSecret;
  throw new PluginValidationFault(
    "MISSING_SECRET",
    "The Voiceflow JWT secret is not configured.",
  );
};
