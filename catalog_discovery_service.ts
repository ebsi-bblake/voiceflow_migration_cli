import { authenticate } from "./jwt_authentication_context";
import { sync } from "./logux_websocket_transport";
import { diagnostic } from "./migration_diagnostics";
export type Option = { value: string; label: string };
type Row = Record<string, unknown>;
type Environment = Record<string, unknown>;

const validId = (value: string, name: string): string => {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw diagnostic("Catalog", "invalid-input", {
      endpoint: "catalog",
      nextAction: `Provide a valid ${name}.`,
    });
  return id;
};

const rowToOption = (row: Row): Option => ({
  value: String(row.id).trim(),
  label: String(row.name ?? row.title ?? row.id).trim(),
});

const filterValidRows = (rows: Row[], filter: (row: Row) => boolean): Row[] =>
  rows.filter((row) => {
    const id = String(row.id ?? "").trim();
    return id.length > 0 && filter(row);
  });

const deduplicateOptionsByValue = (
  optionsToDeduplicate: Option[],
): Option[] => [
  ...new Map(
    optionsToDeduplicate.map((option) => [option.value, option] as const),
  ).values(),
];

const sortOptionsDeterministically = (optionsToSort: Option[]): Option[] =>
  [...optionsToSort].sort(
    (a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
  );

const buildRowOptions = (
  rows: Row[],
  filter: (row: Row) => boolean,
): Option[] => {
  const validRows = filterValidRows(rows, filter);
  const optionsById = validRows
    .map(rowToOption)
    .sort((a, b) => a.value.localeCompare(b.value));
  return sortOptionsDeterministically(deduplicateOptionsByValue(optionsById));
};

const includeAllRows = (_row: Row): boolean => true;

const projectBelongsToWorkspace = (workspaceID: string) => (row: Row): boolean =>
  String(row.workspaceID) === workspaceID;

const assistantFolderBelongsToWorkspace = (workspaceID: string) => (row: Row): boolean => {
  const id = String(row.id ?? "").trim();
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const scope = row.scope;
  return (
    /^\d+$/.test(id) &&
    String(row.workspaceID) === workspaceID &&
    name.length > 0 &&
    (scope === undefined || scope === "assistant")
  );
};

const rowOptionsForWorkspace = (workspaceID: string) => (rows: Row[]): Option[] =>
  buildRowOptions(rows, projectBelongsToWorkspace(workspaceID));

const assistantFolderOptionsForWorkspace = (workspaceID: string) => (rows: Row[]): Option[] =>
  buildRowOptions(rows, assistantFolderBelongsToWorkspace(workspaceID));

export const buildOptions = (rows: Row[]) => buildRowOptions(rows, includeAllRows);
export const listWorkspaces = async (token: string) => {
  const a = authenticate(token);
  return sync(a, `creator/${a.creatorID}`, ["workspace.CRUD:REPLACE"]).then(buildOptions);
};
export const listProjects = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"]).then(
    rowOptionsForWorkspace(workspaceID),
  );
};
export const listVersions = async (
  token: string,
  workspaceID: string,
  projectID: string,
) => {
  workspaceID = validId(workspaceID, "workspace ID");
  projectID = validId(projectID, "project ID");
  const a = authenticate(token);
  return sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"])
    .then(selectProject(workspaceID, projectID))
    .then(versionOptionsForSelection(projectID));
};
export const listFolders = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return sync(a, `workspace/${workspaceID}`, ["workspace-folder.REPLACE"]).then(
    assistantFolderOptionsForWorkspace(workspaceID),
  );
};

const selectProject = (workspaceID: string, projectID: string) =>
  (rows: Row[]): Row | undefined => rows.find(
    (row) => String(row.id) === projectID && String(row.workspaceID) === workspaceID,
  );

const versionOptionsForSelection = (projectID: string) => (project: Row | undefined): Option[] => {
  const environments = normalizeEnvironments(project?.environments);
  const projectLabel = getProjectLabel(project, projectID);
  return sortVersionOptions(
    environments.flatMap((environment) =>
      buildVersionOptionsForEnvironment(environment, projectLabel),
    ),
  );
};

const normalizeEnvironments = (value: unknown): Environment[] =>
  Array.isArray(value)
    ? value.filter((environment): environment is Environment =>
        isEnvironment(environment),
      )
    : Object.values(value && typeof value === "object" ? value : {}).filter(
        (environment): environment is Environment => isEnvironment(environment),
      );

const isEnvironment = (value: unknown): value is Environment =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getLabel = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim().length > 0)
    return value.trim();
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fallback;
  const record = value as Row;
  for (const candidate of [
    record.name,
    record.title,
    record.label,
    record.id,
  ]) {
    if (typeof candidate === "string" && candidate.trim().length > 0)
      return candidate.trim();
  }
  return fallback;
};

const getProjectLabel = (project: Row | undefined, fallback: string): string =>
  getLabel(project, fallback);

const getEnvironmentLabel = (environment: Environment): string =>
  getLabel(environment, "environment");

const createVersionOption = (
  environment: Environment,
  projectName: unknown,
  versionType: "Draft" | "Published",
  versionIDKey: "draftVersionID" | "publishedVersionID",
): Option | null => {
  const versionID = environment[versionIDKey];
  if (!versionID) return null;
  return {
    value: String(versionID),
    label: `[${versionType}] ${getLabel(projectName, "project")} — ${
      getEnvironmentLabel(environment)
    }`,
  };
};

const buildVersionOptionsForEnvironment = (
  environment: Environment,
  projectLabel: string,
): Option[] =>
  [
    createDraftVersionOption(environment, projectLabel),
    createPublishedVersionOption(environment, projectLabel),
  ].filter((option): option is Option => option !== null);

const createDraftVersionOption = (
  environment: Environment,
  projectName: unknown,
): Option | null =>
  createVersionOption(environment, projectName, "Draft", "draftVersionID");

const createPublishedVersionOption = (
  environment: Environment,
  projectName: unknown,
): Option | null =>
  createVersionOption(
    environment,
    projectName,
    "Published",
    "publishedVersionID",
  );

const sortVersionOptions = (versionOptions: Option[]): Option[] =>
  [...versionOptions].sort((a, b) => a.label.localeCompare(b.label));
