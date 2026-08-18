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

export const buildOptions = (rows: Row[]) => buildRowOptions(rows, () => true);
export const listWorkspaces = async (token: string) => {
  const a = authenticate(token);
  return buildRowOptions(
    await sync(a, `creator/${a.creatorID}`, ["workspace.CRUD:REPLACE"]),
    () => true,
  );
};
export const listProjects = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return buildRowOptions(
    await sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"]),
    (r) => String(r.workspaceID) === workspaceID,
  );
};
export const listVersions = async (
  token: string,
  workspaceID: string,
  projectID: string,
) => {
  workspaceID = validId(workspaceID, "workspace ID");
  projectID = validId(projectID, "project ID");
  const a = authenticate(token),
    p = (
      await sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"])
    ).find(
      (r) =>
        String(r.id) === projectID && String(r.workspaceID) === workspaceID,
    );
  const environments = normalizeEnvironments(p?.environments);
  return sortVersionOptions(
    environments.flatMap((environment) =>
      buildVersionOptionsForEnvironment(environment, getProjectLabel(p, projectID)),
    ),
  );
};
export const listFolders = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return buildRowOptions(
    await sync(a, `workspace/${workspaceID}`, ["workspace-folder.REPLACE"]),
    (r) => {
      const id = String(r.id ?? "").trim();
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const scope = r.scope;
      return (
        /^\d+$/.test(id) &&
        String(r.workspaceID) === workspaceID &&
        name.length > 0 &&
        (scope === undefined || scope === "assistant")
      );
    },
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
