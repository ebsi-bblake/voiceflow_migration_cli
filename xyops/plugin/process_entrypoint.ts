import type { Writable } from "node:stream";
import { dispatchOperation } from "./operation_dispatch";
import type { NativePluginJob, OperationHandlers, PluginInput, PluginStage, XYOpsPluginResponse } from "./types";
import { readVoiceflowJWT } from "./job_validation";
import { readPluginJob } from "./stdin_job";
import { mapVoiceflowEnvelope, mapPluginError } from "./wire_protocol";
import {
  formatPluginDiagnostic,
} from "./diagnostics";

type PluginEnvironment = Readonly<Record<string, string | undefined>>;
type PluginOutput = Pick<Writable, "write">;
type WriteDiagnostic = (diagnostics: PluginOutput | undefined, diagnostic: string) => void;
const writeDiagnostic: WriteDiagnostic = (diagnostics, diagnostic) => {
  if (diagnostics === undefined) return;
  diagnostics.write(`${diagnostic}\n`);
};

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
    writeDiagnostic(diagnostics, diagnostic);
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
