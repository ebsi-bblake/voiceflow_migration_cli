import { asCliError, fail, CliError } from "./diagnostics";
import {
  isJobLaunch,
  normalizeVoiceflowResponse,
  isXYOpsLaunchResponse,
  isXYOpsJob,
  isXYOpsJobResponse,
  isXYOpsResponse,
  isXYOpsWaitResponse,
  isRetryableStatus,
  isSuccessfulCode,
  isCompletedJob,
} from "./guards";
import type { EventParameters, ResponseGuard, XYOpsJob, XYOpsResponse, VoiceflowEnvelope, XYOpsConfig as ClientConfig, XYOpsEventReference, XYOpsClient } from "./types";

const WAIT_PATH = "/api/app/run_event/v1/wait";
const RUN_PATH = "/api/app/run_event/v1";
const JOB_PATH = "/api/app/get_job/v1";
const MAX_READ_ATTEMPTS = 3;

type Sleep = (milliseconds: number) => Promise<void>;
const sleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

type FetchJSON = (
  fetcher: typeof fetch,
  url: string,
  apiKey: string,
  body: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  endpoint: string,
) => Promise<XYOpsResponse>;
type FetchRequest = (fetcher: typeof fetch, url: string, apiKey: string, body: Readonly<Record<string, unknown>>, timeoutMs: number, endpoint: string) => Promise<Response>;
const fetchRequest: FetchRequest = async (fetcher, url, apiKey, body, timeoutMs, endpoint) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetcher(url, { method: "POST", headers: { "content-type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify(body), signal: controller.signal }).catch((error) => Promise.reject(toFetchError(error, endpoint))).finally(() => clearTimeout(timeout));
};
const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";
const toFetchError = (error: unknown, endpoint: string): CliError => isAbortError(error) ? fail("timeout", { endpoint, retryable: true }) : fail("network", { endpoint, retryable: true });
const requireHTTPResponse = (response: Response, endpoint: string): Response => {
  if (!response.ok) throw fail("http", { endpoint, status: response.status, retryable: isRetryableStatus(response.status) });
  return response;
};
const parseJSONResponse = async (response: Response, endpoint: string): Promise<unknown> => {
  return response.json().catch(() => Promise.reject(fail("api", { endpoint, nextAction: "XYOps returned an invalid JSON response." })));
};
const validateAPIResponse = (value: unknown, endpoint: string): XYOpsResponse => {
  if (!isXYOpsResponse(value)) throw fail("api", { endpoint, nextAction: "XYOps returned an invalid response." });
  return validateSuccessfulAPIResponse(value, endpoint);
};
const validateSuccessfulAPIResponse = (value: XYOpsResponse, endpoint: string): XYOpsResponse => {
  if (!isSuccessfulCode(value.code)) throw fail("api", { endpoint, nextAction: "XYOps rejected the migration event." });
  return value;
};
const fetchJSON: FetchJSON = async (
  fetcher,
  url,
  apiKey,
  body,
  timeoutMs,
  endpoint,
) => {
  const response = requireHTTPResponse(await fetchRequest(fetcher, url, apiKey, body, timeoutMs, endpoint), endpoint);
  return validateAPIResponse(await parseJSONResponse(response, endpoint), endpoint);
};

type ReadLaunchID = (response: XYOpsResponse, endpoint: string) => string;
const readTopLaunchID = (response: XYOpsResponse): string | undefined => isXYOpsLaunchResponse(response) ? response.id : undefined;
const readDataLaunchID = (response: XYOpsResponse): string | undefined => {
  if (!hasResponseData(response)) return undefined;
  return readJobLaunchID(response.data);
};
const readJobLaunchID = (value: unknown): string | undefined => isJobLaunch(value) ? value.id : undefined;
const hasResponseData = (response: XYOpsResponse): response is XYOpsResponse & { data: unknown } => "data" in response;
const readLaunchID: ReadLaunchID = (response, endpoint) => {
  const ids = [readTopLaunchID(response), readDataLaunchID(response)];
  const id = ids.find((candidate) => candidate !== undefined);
  if (id !== undefined) return id;
  throw fail("execute-outcome-unknown", {
    endpoint,
    nextAction:
      "The execute dispatch outcome is unknown; reconcile before retrying.",
  });
};

type ReadJobResponse = (response: XYOpsResponse, endpoint: string) => XYOpsJob;
const readNestedJob = (response: XYOpsResponse): XYOpsJob | undefined => {
  if (!hasResponseData(response)) return undefined;
  return readJobValue(response.data);
};
const readJobValue = (value: unknown): XYOpsJob | undefined => isXYOpsJob(value) ? value : undefined;
const invalidJobResponse = (endpoint: string): never => { throw fail("job", { endpoint, nextAction: "XYOps returned an invalid job response." }); };
const readJobResponse: ReadJobResponse = (response, endpoint) => {
  const job = findResponseJob(response);
  if (job !== undefined) return job;
  return invalidJobResponse(endpoint);
};
const findResponseJob = (response: XYOpsResponse): XYOpsJob | undefined => isXYOpsJobResponse(response) ? response.job : readNestedJob(response);

type ReadWaitResponseData = (
  response: XYOpsResponse,
  endpoint: string,
) => unknown;
const readWaitResponseData: ReadWaitResponseData = (response, endpoint) => {
  if (!isXYOpsWaitResponse(response))
    throw fail("api", {
      endpoint,
      nextAction: "XYOps returned an invalid wait response.",
    });
  return readJobOutput(
    requireSuccessfulJob(
      response.job,
      endpoint,
      "The migration event job failed.",
    ),
    endpoint,
  );
};

type XYOpsJobResult = Readonly<{
  code: number | string;
  description?: string;
  output?: string | null;
  data?: unknown;
}>;

const MAX_JOB_FAILURE_DESCRIPTION_LENGTH = 240;

type SelectJobFailureDetail = (job: XYOpsJobResult) => string | undefined;
const selectJobFailureDetail: SelectJobFailureDetail = (job) =>
  [job.description, job.output].find(
    (detail): detail is string =>
      typeof detail === "string" && detail.trim().length > 0,
  );

type HasSensitiveJobFailureDetail = (value: string) => boolean;
const hasSensitiveJobFailureDetail: HasSensitiveJobFailureDetail = (value) =>
  [
    /\b(?:api[\s_-]*key|access[\s_-]*token|password|secret|authorization|bearer|credential)\b/i,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /\b[A-Za-z0-9_-]{40,}\b/,
  ].some((pattern) => pattern.test(value));

type BoundJobFailureDescription = (value: string) => string;
const boundJobFailureDescription: BoundJobFailureDescription = (value) => {
  const normalized = value.replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim();
  return isUnsafeFailureDescription(normalized) ? "XYOps reported a job failure." : truncateFailureDescription(normalized);
};
const isUnsafeFailureDescription = (value: string): boolean => [value.length === 0, value.startsWith("{"), value.startsWith("["), hasSensitiveJobFailureDetail(value)].some(Boolean);
const truncateFailureDescription = (value: string): string => value.length <= MAX_JOB_FAILURE_DESCRIPTION_LENGTH ? value : `${value.slice(0, MAX_JOB_FAILURE_DESCRIPTION_LENGTH - 1).trimEnd()}…`;

type DescribeJobFailure = (job: XYOpsJobResult, fallback: string) => string;
const describeJobFailure: DescribeJobFailure = (job, fallback) => {
  const detail = selectJobFailureDetail(job);
  return detail === undefined ? fallback : boundJobFailureDescription(detail);
};

type RequireSuccessfulJob = (
  job: XYOpsJobResult,
  endpoint: string,
  fallback: string,
) => XYOpsJobResult;
const requireSuccessfulJob: RequireSuccessfulJob = (job, endpoint, fallback) => {
  if (!isSuccessfulCode(job.code))
    throw fail("job", {
      endpoint,
      nextAction: describeJobFailure(job, fallback),
    });
  return job;
};

type ReadJobOutput = (job: XYOpsJobResult, endpoint: string) => unknown;
const hasReadableJobOutput = (job: XYOpsJobResult): job is XYOpsJobResult & { output: string } => typeof job.output === "string" && job.output.trim().length > 0;
const readJobOutput: ReadJobOutput = (job, endpoint) => {
  if (hasReadableJobOutput(job)) {
    return parseJobOutput(job.output, endpoint);
  }
  return readJobData(job, endpoint);
};
const readJobData = (job: XYOpsJobResult, endpoint: string): unknown => {
  if ("data" in job) return job.data;
  throw fail("job", { endpoint, nextAction: "XYOps returned empty job output." });
};
const parseJobOutput = (output: string, endpoint: string): unknown => {
  try { return JSON.parse(output) as unknown; } catch { throw fail("job", { endpoint, nextAction: "XYOps returned malformed job output." }); }
};

type EventBody = (
  eventReference: XYOpsEventReference,
  params: EventParameters,
) => Readonly<Record<string, unknown>>;
const eventBody: EventBody = (eventReference, params) => ({
  ...(typeof eventReference === "string"
    ? { title: eventReference }
    : eventReference),
  params,
});

type ReadEvent = <T>(
  eventReference: XYOpsEventReference,
  params: EventParameters,
  envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>,
) => Promise<VoiceflowEnvelope<T>>;

type CreateClientDependencies = Readonly<{
  fetcher?: typeof fetch;
  sleeper?: Sleep;
}>;

type Request = (path: string, body: Readonly<Record<string, unknown>>, endpoint: string) => Promise<XYOpsResponse>;
type ReadEventAttempt = <T>(request: Request, eventReference: XYOpsEventReference, params: EventParameters, guard: ResponseGuard<VoiceflowEnvelope<T>>) => Promise<VoiceflowEnvelope<T>>;
const requireReadEnvelope = <T>(data: unknown, guard: ResponseGuard<VoiceflowEnvelope<T>>): VoiceflowEnvelope<T> => {
  if (!guard(data)) throw fail("envelope", { endpoint: WAIT_PATH, nextAction: "The migration runner returned an invalid envelope." });
  return data;
};
const readEventAttempt: ReadEventAttempt = async <T>(request: Request, eventReference: XYOpsEventReference, params: EventParameters, guard: ResponseGuard<VoiceflowEnvelope<T>>): Promise<VoiceflowEnvelope<T>> => {
  const data = normalizeVoiceflowResponse(readWaitResponseData(await request(WAIT_PATH, eventBody(eventReference, params), WAIT_PATH), WAIT_PATH));
  return requireReadEnvelope(data, guard);
};
type RetryRead = <T>(request: Request, sleeper: Sleep, intervalMs: number, eventReference: XYOpsEventReference, params: EventParameters, guard: ResponseGuard<VoiceflowEnvelope<T>>, attempt: number, error: unknown) => Promise<VoiceflowEnvelope<T>>;
const retryRead: RetryRead = <T>(request: Request, sleeper: Sleep, intervalMs: number, eventReference: XYOpsEventReference, params: EventParameters, guard: ResponseGuard<VoiceflowEnvelope<T>>, attempt: number, error: unknown): Promise<VoiceflowEnvelope<T>> => {
  const cliError = asCliError(error);
  if (shouldStopRetry(cliError, attempt)) return Promise.reject(cliError);
  return sleeper(Math.min(intervalMs, 250 * 2 ** attempt)).then(() => readEventWithRetry(request, sleeper, intervalMs, eventReference, params, guard, attempt + 1));
};
const shouldStopRetry = (error: CliError, attempt: number): boolean => !isRetryableReadError(error) || attempt === MAX_READ_ATTEMPTS - 1;
type ReadEventWithRetry = <T>(request: Request, sleeper: Sleep, intervalMs: number, eventReference: XYOpsEventReference, params: EventParameters, guard: ResponseGuard<VoiceflowEnvelope<T>>, attempt?: number) => Promise<VoiceflowEnvelope<T>>;
const readEventWithRetry: ReadEventWithRetry = (request, sleeper, intervalMs, eventReference, params, guard, attempt = 0) => readEventAttempt(request, eventReference, params, guard).catch((error) => retryRead(request, sleeper, intervalMs, eventReference, params, guard, attempt, error));
const translateExecuteDispatchError = (error: unknown): CliError => {
  const diagnostic = readDiagnostic(error);
  return fail(dispatchErrorCode(diagnostic.code), { endpoint: RUN_PATH, status: diagnostic.status, nextAction: "The execute dispatch outcome is unknown; reconcile before retrying." });
};
const readDiagnostic = (error: unknown): CliError["diagnostic"] => error instanceof CliError ? error.diagnostic : fail("execute-outcome-unknown").diagnostic;
const dispatchErrorCode = (code: CliError["diagnostic"]["code"]): CliError["diagnostic"]["code"] => ["timeout", "network"].includes(code) ? "execute-outcome-unknown" : code;
const translateExecuteJobError = (error: unknown): CliError => {
  const diagnostic = readOptionalDiagnostic(error);
  return unknownJobError(diagnostic) ?? requireCliError(error);
};
const unknownJobError = (diagnostic: CliError["diagnostic"] | undefined): CliError | undefined => {
  if (!isUnknownJobOutcome(diagnostic)) return undefined;
  return fail("execute-outcome-unknown", { endpoint: JOB_PATH, status: diagnosticStatus(diagnostic), nextAction: "The execute job outcome is unknown; reconcile before retrying." });
};
const diagnosticStatus = (diagnostic: CliError["diagnostic"] | undefined): number | undefined => diagnostic === undefined ? undefined : diagnostic.status;
const readOptionalDiagnostic = (error: unknown): CliError["diagnostic"] | undefined => error instanceof CliError ? error.diagnostic : undefined;
const isUnknownJobOutcome = (diagnostic: CliError["diagnostic"] | undefined): boolean => diagnostic !== undefined && ["timeout", "network"].includes(diagnostic.code);
const requireCliError = (error: unknown): CliError => error instanceof CliError ? error : fail("execute-outcome-unknown");

type CreateXYOpsClient = (
  config: ClientConfig,
  dependencies?: CreateClientDependencies,
) => XYOpsClient;
const resolveFetcher = (fetcher: typeof fetch | undefined): typeof fetch => fetcher === undefined ? fetch : fetcher;
const resolveSleeper = (sleeper: Sleep | undefined): Sleep => sleeper === undefined ? sleep : sleeper;
export const createXYOpsClient: CreateXYOpsClient = (
  config,
  dependencies = {},
) => {
  const fetcher = resolveFetcher(dependencies.fetcher);
  const sleeper = resolveSleeper(dependencies.sleeper);
  const request: Request = (path, body, endpoint) =>
    fetchJSON(
      fetcher,
      `${config.baseURL}${path}`,
      config.apiKey,
      body,
      config.httpTimeoutMs,
      endpoint,
    );

  const readEvent: ReadEvent = <T>(
    eventReference: XYOpsEventReference,
    params: EventParameters,
    envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>,
  ) => readEventWithRetry(request, sleeper, config.pollIntervalMs, eventReference, params, envelopeGuard);

  const executeEvent: ReadEvent = <T>(
    eventReference: XYOpsEventReference,
    params: EventParameters,
    envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>,
  ) => request(RUN_PATH, eventBody(eventReference, params), RUN_PATH)
    .catch((error) => Promise.reject(translateExecuteDispatchError(error)))
    .then((launch) => pollJob(readLaunchID(launch, RUN_PATH), request, sleeper, config, envelopeGuard))
    .catch((error) => Promise.reject(translateExecuteJobError(error)));

  return { readEvent, executeEvent };
};

type IsRetryableReadError = (error: CliError) => boolean;
const isRetryableReadError: IsRetryableReadError = (error) =>
  [error.diagnostic.retryable, error.diagnostic.code === "timeout", error.diagnostic.code === "network", error.diagnostic.code === "http"].every(Boolean);

type RequestJob = <T>(
  id: string,
  request: (
    path: string,
    body: Readonly<Record<string, unknown>>,
    endpoint: string,
  ) => Promise<XYOpsResponse>,
  sleeper: Sleep,
  config: ClientConfig,
  envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>,
) => Promise<VoiceflowEnvelope<T>>;
type PollUntilComplete = <T>(id: string, request: Request, sleeper: Sleep, intervalMs: number, deadline: number, guard: ResponseGuard<VoiceflowEnvelope<T>>) => Promise<VoiceflowEnvelope<T>>;
const pollUntilComplete: PollUntilComplete = async <T>(id: string, request: Request, sleeper: Sleep, intervalMs: number, deadline: number, guard: ResponseGuard<VoiceflowEnvelope<T>>): Promise<VoiceflowEnvelope<T>> => {
  const job = readJobResponse(await request(JOB_PATH, { id }, JOB_PATH), JOB_PATH);
  if (isCompletedJob(job.completed)) return completeJob(job, guard);
  await sleeper(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  return pollNext(id, request, sleeper, intervalMs, deadline, guard);
};
const pollNext = <T>(id: string, request: Request, sleeper: Sleep, intervalMs: number, deadline: number, guard: ResponseGuard<VoiceflowEnvelope<T>>): Promise<VoiceflowEnvelope<T>> => {
  if (Date.now() > deadline) return Promise.reject(fail("execute-outcome-unknown", { endpoint: JOB_PATH, nextAction: "The execute job timed out; reconcile before retrying." }));
  return pollUntilComplete(id, request, sleeper, intervalMs, deadline, guard);
};
const completeJob = <T>(job: XYOpsJobResult, guard: ResponseGuard<VoiceflowEnvelope<T>>): VoiceflowEnvelope<T> => {
  const result = normalizeVoiceflowResponse(readJobOutput(requireSuccessfulJob(job, JOB_PATH, "The migration execute job failed."), JOB_PATH));
  if (!guard(result)) throw fail("envelope", { endpoint: JOB_PATH, nextAction: "The execute job returned an invalid envelope." });
  return result;
};
const pollJob: RequestJob = async <T>(
  id: string,
  request: (
    path: string,
    body: Readonly<Record<string, unknown>>,
    endpoint: string,
  ) => Promise<XYOpsResponse>,
  sleeper: Sleep,
  config: ClientConfig,
  envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>,
): Promise<VoiceflowEnvelope<T>> => {
  const deadline = Date.now() + config.pollTimeoutMs;
  return pollNext(id, request, sleeper, config.pollIntervalMs, deadline, envelopeGuard);
};
