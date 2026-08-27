import { asCliError, fail, CliError } from "./diagnostics";
import {
  isJobLaunch,
  normalizeVoiceflowResponse,
  isXYOpsLaunchResponse,
  isXYOpsJob,
  isXYOpsJobResponse,
  isXYOpsResponse,
  isXYOpsWaitResponse,
  type EventParameters,
  type ResponseGuard,
  type XYOpsJob,
  type XYOpsResponse,
  type VoiceflowEnvelope,
} from "./contracts";
import type {
  XYOpsConfig as ClientConfig,
  XYOpsEventReference,
} from "./config";

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
const fetchJSON: FetchJSON = async (
  fetcher,
  url,
  apiKey,
  body,
  timeoutMs,
  endpoint,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError")
      throw fail("timeout", { endpoint, retryable: true });
    throw fail("network", { endpoint, retryable: true });
  }
  clearTimeout(timeout);
  if (!response.ok)
    throw fail("http", {
      endpoint,
      status: response.status,
      retryable: isRetryableStatus(response.status),
    });
  let bodyValue: unknown;
  try {
    bodyValue = await response.json();
  } catch {
    throw fail("api", {
      endpoint,
      nextAction: "XYOps returned an invalid JSON response.",
    });
  }
  if (!isXYOpsResponse(bodyValue))
    throw fail("api", {
      endpoint,
      nextAction: "XYOps returned an invalid response.",
    });
  if (!isSuccessfulCode(bodyValue.code))
    throw fail("api", {
      endpoint,
      nextAction: "XYOps rejected the migration event.",
    });
  return bodyValue;
};

type IsRetryableStatus = (status: number) => boolean;
const isRetryableStatus: IsRetryableStatus = (status) =>
  status === 408 || status === 429 || status >= 500;

type IsSuccessfulCode = (code: number | string) => boolean;
const isSuccessfulCode: IsSuccessfulCode = (code) =>
  code === 0 ||
  code === 200 ||
  code === "0" ||
  code === "200" ||
  code === "OK" ||
  code === "ok";

type ReadLaunchID = (response: XYOpsResponse, endpoint: string) => string;
const readLaunchID: ReadLaunchID = (response, endpoint) => {
  if (isXYOpsLaunchResponse(response)) return response.id;
  if ("data" in response && isJobLaunch(response.data)) return response.data.id;
  throw fail("execute-outcome-unknown", {
    endpoint,
    nextAction:
      "The execute dispatch outcome is unknown; reconcile before retrying.",
  });
};

type ReadJobResponse = (response: XYOpsResponse, endpoint: string) => XYOpsJob;
const readJobResponse: ReadJobResponse = (response, endpoint) => {
  if (isXYOpsJobResponse(response)) return response.job;
  if ("job" in response)
    throw fail("job", {
      endpoint,
      nextAction: "XYOps returned an invalid job response.",
    });
  if ("data" in response && isXYOpsJob(response.data)) return response.data;
  throw fail("job", {
    endpoint,
    nextAction: "XYOps returned an invalid job response.",
  });
};

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
  /\b(?:api[\s_-]*key|access[\s_-]*token|password|secret|authorization|bearer|credential)\b/i.test(
    value,
  ) ||
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value) ||
  /\b[A-Za-z0-9_-]{40,}\b/.test(value);

type BoundJobFailureDescription = (value: string) => string;
const boundJobFailureDescription: BoundJobFailureDescription = (value) => {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.startsWith("{") ||
    normalized.startsWith("[") ||
    hasSensitiveJobFailureDetail(normalized)
  )
    return "XYOps reported a job failure.";
  if (normalized.length <= MAX_JOB_FAILURE_DESCRIPTION_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_JOB_FAILURE_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
};

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
const readJobOutput: ReadJobOutput = (job, endpoint) => {
  if (typeof job.output === "string" && job.output.trim().length > 0) {
    try {
      return JSON.parse(job.output) as unknown;
    } catch {
      throw fail("job", {
        endpoint,
        nextAction: "XYOps returned malformed job output.",
      });
    }
  }
  if ("data" in job) return job.data;
  throw fail("job", {
    endpoint,
    nextAction: "XYOps returned empty job output.",
  });
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

export type XYOpsClient = Readonly<{
  readEvent: ReadEvent;
  executeEvent: ReadEvent;
}>;

type CreateXYOpsClient = (
  config: ClientConfig,
  dependencies?: CreateClientDependencies,
) => XYOpsClient;
export const createXYOpsClient: CreateXYOpsClient = (
  config,
  dependencies = {},
) => {
  const fetcher = dependencies.fetcher ?? fetch;
  const sleeper = dependencies.sleeper ?? sleep;
  type Request = (
    path: string,
    body: Readonly<Record<string, unknown>>,
    endpoint: string,
  ) => Promise<XYOpsResponse>;
  const request: Request = (path, body, endpoint) =>
    fetchJSON(
      fetcher,
      `${config.baseURL}${path}`,
      config.apiKey,
      body,
      config.httpTimeoutMs,
      endpoint,
    );

  const readEvent: ReadEvent = async <T>(
    eventReference: XYOpsEventReference,
    params: EventParameters,
    envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>,
  ) => {
    let lastError: CliError | undefined;
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
      try {
        const response = await request(
          WAIT_PATH,
          eventBody(eventReference, params),
          WAIT_PATH,
        );
        const data = normalizeVoiceflowResponse(
          readWaitResponseData(response, WAIT_PATH),
        );
        if (!envelopeGuard(data))
          throw fail("envelope", {
            endpoint: WAIT_PATH,
            nextAction: "The migration runner returned an invalid envelope.",
          });
        return data;
      } catch (error) {
        lastError = asCliError(error);
        if (
          !isRetryableReadError(lastError) ||
          attempt === MAX_READ_ATTEMPTS - 1
        )
          throw lastError;
        await sleeper(Math.min(config.pollIntervalMs, 250 * 2 ** attempt));
      }
    }
    throw lastError ?? fail("network", { endpoint: WAIT_PATH });
  };

  const executeEvent: ReadEvent = async <T>(
    eventReference: XYOpsEventReference,
    params: EventParameters,
    envelopeGuard: ResponseGuard<VoiceflowEnvelope<T>>,
  ) => {
    let launch: XYOpsResponse;
    try {
      launch = await request(
        RUN_PATH,
        eventBody(eventReference, params),
        RUN_PATH,
      );
    } catch (error) {
      const diagnostic =
        error instanceof CliError
          ? error.diagnostic
          : fail("execute-outcome-unknown").diagnostic;
      throw fail(
        diagnostic.code === "timeout" || diagnostic.code === "network"
          ? "execute-outcome-unknown"
          : diagnostic.code,
        {
          endpoint: RUN_PATH,
          status: diagnostic.status,
          nextAction:
            "The execute dispatch outcome is unknown; reconcile before retrying.",
        },
      );
    }
    const launchID = readLaunchID(launch, RUN_PATH);
    try {
      return await pollJob(launchID, request, sleeper, config, envelopeGuard);
    } catch (error) {
      const diagnostic =
        error instanceof CliError ? error.diagnostic : undefined;
      if (diagnostic?.code === "timeout" || diagnostic?.code === "network")
        throw fail("execute-outcome-unknown", {
          endpoint: JOB_PATH,
          status: diagnostic.status,
          nextAction:
            "The execute job outcome is unknown; reconcile before retrying.",
        });
      throw error;
    }
  };

  return { readEvent, executeEvent };
};

type IsRetryableReadError = (error: CliError) => boolean;
const isRetryableReadError: IsRetryableReadError = (error) =>
  error.diagnostic.retryable &&
  (error.diagnostic.code === "timeout" ||
    error.diagnostic.code === "network" ||
    error.diagnostic.code === "http");

type IsCompletedJob = (completed: boolean | number | null | undefined) => boolean;
const isCompletedJob: IsCompletedJob = (completed) =>
  completed === true || (typeof completed === "number" && completed > 0);

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
) => {
  const deadline = Date.now() + config.pollTimeoutMs;
  while (Date.now() <= deadline) {
    const response = await request(JOB_PATH, { id }, JOB_PATH);
    const job = readJobResponse(response, JOB_PATH);
    if (!isCompletedJob(job.completed)) {
      await sleeper(
        Math.min(config.pollIntervalMs, Math.max(0, deadline - Date.now())),
      );
      continue;
    }
    const successfulJob = requireSuccessfulJob(
      job,
      JOB_PATH,
      "The migration execute job failed.",
    );
    const result = normalizeVoiceflowResponse(
      readJobOutput(successfulJob, JOB_PATH),
    );
    if (!envelopeGuard(result))
      throw fail("envelope", {
        endpoint: JOB_PATH,
        nextAction: "The execute job returned an invalid envelope.",
      });
    return result;
  }
  throw fail("execute-outcome-unknown", {
    endpoint: JOB_PATH,
    nextAction: "The execute job timed out; reconcile before retrying.",
  });
};
