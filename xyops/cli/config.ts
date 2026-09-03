import { fail } from "./diagnostics";
import { isInvalidDuration } from "./guards";
import { parseXYOpsURL } from "../voiceflow/vf_urls";
import type {
  XYOpsConfig,
  XYOpsEventConfig,
  XYOpsEventReference,
} from "./types";
export type {
  XYOpsConfig,
  XYOpsEventConfig,
  XYOpsEventReference,
} from "./types";

export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_POLL_TIMEOUT_MS = 300_000;
export const DEFAULT_STREAM_MAX_BYTES = 1_048_576;
export const DEFAULT_STREAM_MAX_FRAME_BYTES = 256_000;
export const DEFAULT_XYOPS_BASE_URL = "http://localhost:5522";

const DEFAULT_EVENT_TITLES = {
  checkSession: "voiceflow_check_session",
  listWorkspaces: "voiceflow_list_workspaces",
  listProjects: "voiceflow_list_projects",
  listVersions: "voiceflow_list_versions",
  listFolders: "voiceflow_list_folders",
  planMigration: "voiceflow_plan_migration",
  executeMigration: "voiceflow_execute_migration",
} as const;

type Environment = Readonly<Record<string, string | undefined>>;

type ReadTrimmedEnvironment = (
  environment: Environment,
  name: string,
) => string;
const readTrimmedEnvironment: ReadTrimmedEnvironment = (environment, name) =>
  (environment[name] ?? "").trim();

type RequiredEnvironment = (environment: Environment, name: string) => string;
const requiredEnvironment: RequiredEnvironment = (environment, name) => {
  const value = readTrimmedEnvironment(environment, name);
  if (!value)
    throw fail("configuration", { nextAction: `${name} is not configured.` });
  return value;
};

type EventReferenceParser = (
  value: string,
  name: string,
) => XYOpsEventReference;
type ParseEventId = EventReferenceParser;
const parseEventId: ParseEventId = (value, name) => {
  if (!value)
    throw fail("configuration", {
      nextAction: `${name} must include an event ID.`,
    });
  return { id: value };
};
type ParseEventTitle = EventReferenceParser;
const parseEventTitle: ParseEventTitle = (value, name) => {
  if (!value)
    throw fail("configuration", {
      nextAction: `${name} must include an event title.`,
    });
  return { title: value };
};
const EVENT_REFERENCE_PARSERS: Readonly<Record<string, EventReferenceParser>> =
  {
    "": parseEventId,
    "id:": parseEventId,
    "title:": parseEventTitle,
  };
const EVENT_REFERENCE_PREFIXES = ["id:", "title:"] as const;
type FindEventReferencePrefix = (value: string) => string;
const findEventReferencePrefix: FindEventReferencePrefix = (value) =>
  EVENT_REFERENCE_PREFIXES.find((prefix) => value.startsWith(prefix)) ?? "";

type ReadEventReference = (
  environment: Environment,
  name: string,
  fallback: string,
) => XYOpsEventReference;
const readEventReference: ReadEventReference = (
  environment,
  name,
  fallback,
) => {
  const value = readTrimmedEnvironment(environment, name);
  if (!value) return { title: fallback };
  const prefix = findEventReferencePrefix(value);
  return EVENT_REFERENCE_PARSERS[prefix](
    value.slice(prefix.length).trim(),
    name,
  );
};

type PositiveMilliseconds = (
  environment: Environment,
  name: string,
  fallback: number,
) => number;
const positiveMilliseconds: PositiveMilliseconds = (
  environment,
  name,
  fallback,
) => {
  const raw = readTrimmedEnvironment(environment, name);
  return raw ? parseDuration(raw, name) : fallback;
};

type ValidateDuration = (value: number, name: string) => void;
const validateDuration: ValidateDuration = (value, name) => {
  if (isInvalidDuration(value))
    throw fail("configuration", {
      nextAction: `${name} must be a positive duration.`,
    });
};

type ParseDuration = (raw: string, name: string) => number;
const parseDuration: ParseDuration = (raw, name) => {
  const value = Number(raw);
  validateDuration(value, name);
  return Math.floor(value);
};

type NormalizeBaseURL = (value: string) => string;
const normalizeBaseURL: NormalizeBaseURL = (value) => {
  try {
    return parseXYOpsURL(value);
  } catch {
    throw fail("configuration", {
      nextAction: "XYOPS_BASE_URL must be a valid HTTP URL without credentials or fragments.",
    });
  }
};

type ReadBaseURL = (environment: Environment) => string;
const readBaseURL: ReadBaseURL = (environment) =>
  normalizeBaseURL(
    readTrimmedEnvironment(environment, "XYOPS_BASE_URL") ||
      DEFAULT_XYOPS_BASE_URL,
  );

type ReadEventConfig = (environment: Environment) => XYOpsEventConfig;
const readEventConfig: ReadEventConfig = (environment) => ({
  checkSession: readEventReference(
    environment,
    "XYOPS_EVENT_CHECK_SESSION",
    DEFAULT_EVENT_TITLES.checkSession,
  ),
  listWorkspaces: readEventReference(
    environment,
    "XYOPS_EVENT_LIST_WORKSPACES",
    DEFAULT_EVENT_TITLES.listWorkspaces,
  ),
  listProjects: readEventReference(
    environment,
    "XYOPS_EVENT_LIST_PROJECTS",
    DEFAULT_EVENT_TITLES.listProjects,
  ),
  listVersions: readEventReference(
    environment,
    "XYOPS_EVENT_LIST_VERSIONS",
    DEFAULT_EVENT_TITLES.listVersions,
  ),
  listFolders: readEventReference(
    environment,
    "XYOPS_EVENT_LIST_FOLDERS",
    DEFAULT_EVENT_TITLES.listFolders,
  ),
  planMigration: readEventReference(
    environment,
    "XYOPS_EVENT_PLAN_MIGRATION",
    DEFAULT_EVENT_TITLES.planMigration,
  ),
  executeMigration: readEventReference(
    environment,
    "XYOPS_EVENT_EXECUTE_MIGRATION",
    DEFAULT_EVENT_TITLES.executeMigration,
  ),
});

type ReadDurations = (environment: Environment) => Readonly<{
  httpTimeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  streamMaxBytes: number;
  streamMaxFrameBytes: number;
}>;
const readDurations: ReadDurations = (environment) => ({
  httpTimeoutMs: positiveMilliseconds(
    environment,
    "XYOPS_HTTP_TIMEOUT_MS",
    DEFAULT_HTTP_TIMEOUT_MS,
  ),
  pollIntervalMs: positiveMilliseconds(
    environment,
    "XYOPS_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  ),
  pollTimeoutMs: positiveMilliseconds(
    environment,
    "XYOPS_POLL_TIMEOUT_MS",
    DEFAULT_POLL_TIMEOUT_MS,
  ),
  streamMaxBytes: positiveMilliseconds(
    environment,
    "XYOPS_STREAM_MAX_BYTES",
    DEFAULT_STREAM_MAX_BYTES,
  ),
  streamMaxFrameBytes: positiveMilliseconds(
    environment,
    "XYOPS_STREAM_MAX_FRAME_BYTES",
    DEFAULT_STREAM_MAX_FRAME_BYTES,
  ),
});

type ReadXYOpsConfig = (environment?: Environment) => XYOpsConfig;
export const readXYOpsConfig: ReadXYOpsConfig = (
  environment = process.env,
) => ({
  baseURL: readBaseURL(environment),
  apiKey: requiredEnvironment(environment, "XYOPS_API_KEY"),
  events: readEventConfig(environment),
  ...readDurations(environment),
});
