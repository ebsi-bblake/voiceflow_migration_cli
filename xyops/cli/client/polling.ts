import { asCliError, fail, type CliError } from "../diagnostics";
import { isCompletedJob, normalizeVoiceflowResponse } from "../guards";
import type { EventParameters, ResponseGuard, VoiceflowEnvelope, XYOpsConfig, XYOpsEventReference } from "../types";
import { type Request, type Sleep } from "./http";
import { readJobOutput, readJobResponse, readWaitResponseData, requireEnvelope, requireSuccessfulJob } from "./job-response";

const WAIT_PATH = "/api/app/run_event/v1/wait";
const JOB_PATH = "/api/app/get_job/v1";
const MAX_READ_ATTEMPTS = 3;

type EventBody = (reference: XYOpsEventReference, params: EventParameters) => Readonly<Record<string, unknown>>;
export const eventBody: EventBody = (reference, params) => ({
  ...(typeof reference === "string" ? { title: reference } : reference),
  params,
});

export const readEventWithRetry = <T>(
  request: Request,
  sleeper: Sleep,
  intervalMs: number,
  reference: XYOpsEventReference,
  params: EventParameters,
  guard: ResponseGuard<VoiceflowEnvelope<T>>,
  attempt = 0,
): Promise<VoiceflowEnvelope<T>> =>
  readEventAttempt(request, reference, params, guard).catch((error) =>
    retryRead(request, sleeper, intervalMs, reference, params, guard, attempt, error),
  );

const readEventAttempt = <T>(
  request: Request,
  reference: XYOpsEventReference,
  params: EventParameters,
  guard: ResponseGuard<VoiceflowEnvelope<T>>,
): Promise<VoiceflowEnvelope<T>> =>
  request(WAIT_PATH, eventBody(reference, params), WAIT_PATH)
    .then((response) => normalizeVoiceflowResponse(readWaitResponseData(response, WAIT_PATH)))
    .then((data) => requireEnvelope(data, guard, WAIT_PATH));

const isRetryableReadError = (error: CliError): boolean =>
  error.diagnostic.retryable && ["timeout", "network", "http"].includes(error.diagnostic.code);

// Retry policy combines transport classification and the bounded attempt count.
// oxlint-disable-next-line complexity
const retryRead = <T>(
  request: Request,
  sleeper: Sleep,
  intervalMs: number,
  reference: XYOpsEventReference,
  params: EventParameters,
  guard: ResponseGuard<VoiceflowEnvelope<T>>,
  attempt: number,
  error: unknown,
): Promise<VoiceflowEnvelope<T>> => {
  const cliError = asCliError(error);
  return !isRetryableReadError(cliError) || attempt === MAX_READ_ATTEMPTS - 1
    ? Promise.reject(cliError)
    : sleeper(Math.min(intervalMs, 250 * 2 ** attempt)).then(() =>
        readEventWithRetry(request, sleeper, intervalMs, reference, params, guard, attempt + 1),
      );
};

const completeJob = <T>(
  job: Readonly<{ code: number | string; output?: string | null; data?: unknown; description?: string }>,
  guard: ResponseGuard<VoiceflowEnvelope<T>>,
): VoiceflowEnvelope<T> => {
  const result = normalizeVoiceflowResponse(
    readJobOutput(requireSuccessfulJob(job, JOB_PATH, "The migration execute job failed."), JOB_PATH),
  );
  if (!guard(result))
    throw fail("envelope", {
      endpoint: JOB_PATH,
      nextAction: "The execute job returned an invalid envelope.",
    });
  return result;
};

// Polling intentionally checks completion and deadline at each remote observation.
// oxlint-disable-next-line complexity
const pollUntilComplete = async <T>(
  id: string,
  request: Request,
  sleeper: Sleep,
  intervalMs: number,
  deadline: number,
  guard: ResponseGuard<VoiceflowEnvelope<T>>,
): Promise<VoiceflowEnvelope<T>> => {
  const job = readJobResponse(await request(JOB_PATH, { id }, JOB_PATH), JOB_PATH);
  if (isCompletedJob(job.completed)) return completeJob(job, guard);
  await sleeper(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  if (Date.now() > deadline)
    return Promise.reject(fail("execute-outcome-unknown", {
      endpoint: JOB_PATH,
      nextAction: "The execute job timed out; reconcile before retrying.",
    }));
  return pollUntilComplete(id, request, sleeper, intervalMs, deadline, guard);
};

export const pollJob = <T>(
  id: string,
  request: Request,
  sleeper: Sleep,
  config: XYOpsConfig,
  guard: ResponseGuard<VoiceflowEnvelope<T>>,
): Promise<VoiceflowEnvelope<T>> =>
  pollUntilComplete(
    id,
    request,
    sleeper,
    config.pollIntervalMs,
    Date.now() + config.pollTimeoutMs,
    guard,
  );
