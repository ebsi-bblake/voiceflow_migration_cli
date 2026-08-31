import { fail, CliError } from "../diagnostics";
import type { EventParameters, ResponseGuard, VoiceflowEnvelope, XYOpsClient, XYOpsConfig, XYOpsEventReference } from "../types";
import { fetchJSON, defaultSleep, type Request, type Sleep } from "./http";
import { eventBody, pollJob, readEventWithRetry } from "./polling";
import { readLaunchID } from "./job-response";

const RUN_PATH = "/api/app/run_event/v1";
const JOB_PATH = "/api/app/get_job/v1";

type CreateClientDependencies = Readonly<{ fetcher?: typeof fetch; sleeper?: Sleep }>;

const readDiagnostic = (error: unknown): CliError["diagnostic"] =>
  error instanceof CliError ? error.diagnostic : fail("execute-outcome-unknown").diagnostic;

const translateExecuteDispatchError = (error: unknown): CliError => {
  const diagnostic = readDiagnostic(error);
  const code = ["timeout", "network"].includes(diagnostic.code)
    ? "execute-outcome-unknown"
    : diagnostic.code;
  return fail(code, {
    endpoint: RUN_PATH,
    status: diagnostic.status,
    nextAction: "The execute dispatch outcome is unknown; reconcile before retrying.",
  });
};

// The translation must distinguish transport errors from already-classified CLI failures.
// oxlint-disable-next-line complexity
const translateExecuteJobError = (error: unknown): CliError => {
  const diagnostic = error instanceof CliError ? error.diagnostic : undefined;
  if (diagnostic && ["timeout", "network"].includes(diagnostic.code))
    return fail("execute-outcome-unknown", {
      endpoint: JOB_PATH,
      status: diagnostic.status,
      nextAction: "The execute job outcome is unknown; reconcile before retrying.",
    });
  return error instanceof CliError ? error : fail("execute-outcome-unknown");
};

// Client construction binds optional infrastructure dependencies once at the boundary.
// oxlint-disable-next-line complexity
export const createXYOpsClient = (
  config: XYOpsConfig,
  dependencies: CreateClientDependencies = {},
): XYOpsClient => {
  const fetcher = dependencies.fetcher ?? fetch;
  const sleeper = dependencies.sleeper ?? defaultSleep;
  const request: Request = (path, body, endpoint) =>
    fetchJSON(fetcher, `${config.baseURL}${path}`, config.apiKey, body, config.httpTimeoutMs, endpoint);

  const readEvent = <T>(
    reference: XYOpsEventReference,
    params: EventParameters,
    guard: ResponseGuard<VoiceflowEnvelope<T>>,
  ): Promise<VoiceflowEnvelope<T>> =>
    readEventWithRetry(request, sleeper, config.pollIntervalMs, reference, params, guard);

  const executeEvent = <T>(
    reference: XYOpsEventReference,
    params: EventParameters,
    guard: ResponseGuard<VoiceflowEnvelope<T>>,
  ): Promise<VoiceflowEnvelope<T>> =>
    request(RUN_PATH, eventBody(reference, params), RUN_PATH)
      .catch((error) => Promise.reject(translateExecuteDispatchError(error)))
      .then((launch) => readLaunchID(launch, RUN_PATH))
      .then((id) => pollJob(id, request, sleeper, config, guard))
      .catch((error) => Promise.reject(translateExecuteJobError(error)));

  return { readEvent, executeEvent };
};
