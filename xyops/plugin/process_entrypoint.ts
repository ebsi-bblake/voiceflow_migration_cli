import type { Writable } from "node:stream";
import { dispatchOperation, type OperationHandlers } from "./operation_dispatch";
import {
  type NativePluginJob,
  type XYOpsPluginResponse,
} from "./contracts";
import { readVoiceflowJWT } from "./job_validation";
import { readPluginJob, type PluginInput } from "./stdin_job";
import { mapVoiceflowEnvelope, mapPluginError } from "./wire_protocol";
import {
  formatPluginDiagnostic,
  type PluginStage,
} from "./diagnostics";

type PluginEnvironment = Readonly<Record<string, string | undefined>>;
type PluginOutput = Pick<Writable, "write">;

type BuildPluginResponse = (
  input: PluginInput,
  environment: PluginEnvironment,
  handlers?: OperationHandlers,
  diagnostics?: PluginOutput,
) => Promise<XYOpsPluginResponse>;
export const buildPluginResponse: BuildPluginResponse = async (
  input,
  environment,
  handlers,
  diagnostics,
) => {
  let stage: PluginStage = "input";
  try {
    const job: NativePluginJob = await readPluginJob(input);
    stage = "secret";
    const token = readVoiceflowJWT(environment);
    stage = "dispatch";
    const envelope = await dispatchOperation(job, token, handlers);
    stage = "response";
    return mapVoiceflowEnvelope(envelope);
  } catch (error: unknown) {
    const diagnostic = formatPluginDiagnostic(stage, error);
    diagnostics?.write(`${diagnostic}\n`);
    return mapPluginError(error, diagnostic);
  }
};

type RunNativePlugin = (
  input: PluginInput,
  output: PluginOutput,
  environment?: PluginEnvironment,
  handlers?: OperationHandlers,
  diagnostics?: PluginOutput,
) => Promise<number>;
export const runNativePlugin: RunNativePlugin = (
  input,
  output,
  environment = process.env,
  handlers,
  diagnostics,
) =>
  buildPluginResponse(input, environment, handlers, diagnostics).then((response) => {
    output.write(`${JSON.stringify(response)}\n`);
    return 0;
  });
