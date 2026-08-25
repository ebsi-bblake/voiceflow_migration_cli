import { fail } from "./diagnostics";

export type XYOpsEventConfig = Readonly<{
  checkSession: XYOpsEventReference;
  listWorkspaces: XYOpsEventReference;
  listProjects: XYOpsEventReference;
  listVersions: XYOpsEventReference;
  listFolders: XYOpsEventReference;
  planMigration: XYOpsEventReference;
  executeMigration: XYOpsEventReference;
}>;

export type XYOpsEventReference =
  | string
  | Readonly<{ id: string }>
  | Readonly<{ title: string }>;

export type XYOpsConfig = Readonly<{
  baseURL: string;
  apiKey: string;
  events: XYOpsEventConfig;
  httpTimeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}>;

export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_POLL_TIMEOUT_MS = 300_000;
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

type RequiredEnvironment = (environment: Environment, name: string) => string;
const requiredEnvironment: RequiredEnvironment = (environment, name) => {
  const value = environment[name]?.trim();
  if (!value) throw fail("configuration", { nextAction: `${name} is not configured.` });
  return value;
};

type ReadEventReference = (environment: Environment, name: string, fallback: string) => XYOpsEventReference;
const readEventReference: ReadEventReference = (environment, name, fallback) => {
  const value = environment[name]?.trim();
  if (!value) return { title: fallback };
  if (value.startsWith("id:")) {
    const id = value.slice("id:".length).trim();
    if (!id) throw fail("configuration", { nextAction: `${name} must include an event ID.` });
    return { id };
  }
  if (value.startsWith("title:")) {
    const title = value.slice("title:".length).trim();
    if (!title) throw fail("configuration", { nextAction: `${name} must include an event title.` });
    return { title };
  }
  return { id: value };
};

type PositiveMilliseconds = (
  environment: Environment,
  name: string,
  fallback: number,
) => number;
const positiveMilliseconds: PositiveMilliseconds = (environment, name, fallback) => {
  const raw = environment[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 3_600_000)
    throw fail("configuration", { nextAction: `${name} must be a positive duration.` });
  return Math.floor(value);
};

type NormalizeBaseURL = (value: string) => string;
const normalizeBaseURL: NormalizeBaseURL = (value) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fail("configuration", { nextAction: "XYOPS_BASE_URL must be a valid HTTP URL." });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw fail("configuration", { nextAction: "XYOPS_BASE_URL must use HTTP or HTTPS." });
  return url.toString().replace(/\/$/, "");
};

type ReadXYOpsConfig = (environment?: Environment) => XYOpsConfig;
export const readXYOpsConfig: ReadXYOpsConfig = (environment = process.env) => ({
  baseURL: normalizeBaseURL(environment.XYOPS_BASE_URL?.trim() || DEFAULT_XYOPS_BASE_URL),
  apiKey: requiredEnvironment(environment, "XYOPS_API_KEY"),
  events: {
    checkSession: readEventReference(environment, "XYOPS_EVENT_CHECK_SESSION", DEFAULT_EVENT_TITLES.checkSession),
    listWorkspaces: readEventReference(environment, "XYOPS_EVENT_LIST_WORKSPACES", DEFAULT_EVENT_TITLES.listWorkspaces),
    listProjects: readEventReference(environment, "XYOPS_EVENT_LIST_PROJECTS", DEFAULT_EVENT_TITLES.listProjects),
    listVersions: readEventReference(environment, "XYOPS_EVENT_LIST_VERSIONS", DEFAULT_EVENT_TITLES.listVersions),
    listFolders: readEventReference(environment, "XYOPS_EVENT_LIST_FOLDERS", DEFAULT_EVENT_TITLES.listFolders),
    planMigration: readEventReference(environment, "XYOPS_EVENT_PLAN_MIGRATION", DEFAULT_EVENT_TITLES.planMigration),
    executeMigration: readEventReference(environment, "XYOPS_EVENT_EXECUTE_MIGRATION", DEFAULT_EVENT_TITLES.executeMigration),
  },
  httpTimeoutMs: positiveMilliseconds(environment, "XYOPS_HTTP_TIMEOUT_MS", DEFAULT_HTTP_TIMEOUT_MS),
  pollIntervalMs: positiveMilliseconds(environment, "XYOPS_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS),
  pollTimeoutMs: positiveMilliseconds(environment, "XYOPS_POLL_TIMEOUT_MS", DEFAULT_POLL_TIMEOUT_MS),
});
