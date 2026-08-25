import type { AuthContext } from "./vf_auth";
import { syncCatalog } from "./vf_logux";
import { OperationFault } from "./vf_contracts";

export type Option = Readonly<{ value: string; label: string }>;
export type WorkspaceRecord = Readonly<{ id: string; label: string }>;
export type EnvironmentRecord = Readonly<{
  label: string;
  draftVersionID?: string;
  publishedVersionID?: string;
}>;
export type ProjectRecord = Readonly<{
  id: string;
  label: string;
  workspaceID: string;
  environments: readonly EnvironmentRecord[];
}>;
export type FolderRecord = Readonly<{
  id: string;
  label: string;
  workspaceID: string;
}>;
type RawRow = Readonly<Record<string, unknown>>;
type VersionField = "draftVersionID" | "publishedVersionID";
type VersionKind = readonly [VersionField, string];

const VERSION_KINDS: readonly VersionKind[] = [
  ["draftVersionID", "[Draft]"],
  ["publishedVersionID", "[Published]"],
];

type IsRawRow = (value: unknown) => value is RawRow;
const isRawRow: IsRawRow = (value): value is RawRow =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type ToID = (row: RawRow) => string | undefined;
const toID: ToID = (row) => {
  const value = row.id ?? row._id;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  return id || undefined;
};

type ToLabel = (row: RawRow, fallback: string) => string;
const toLabel: ToLabel = (row, fallback) => {
  for (const key of ["name", "title", "label"] as const) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
};

type EnvironmentValues = (value: unknown) => readonly RawRow[];
const environmentValues: EnvironmentValues = (value) => {
  if (Array.isArray(value)) return value.filter(isRawRow);
  return isRawRow(value) ? Object.values(value).filter(isRawRow) : [];
};

type ProjectEnvironment = (value: RawRow) => EnvironmentRecord;
const projectEnvironment: ProjectEnvironment = (value) => {
  const draft = value.draftVersionID;
  const published = value.publishedVersionID;
  return {
    label: toLabel(value, "Environment"),
    ...(typeof draft === "string" || typeof draft === "number"
      ? { draftVersionID: String(draft) }
      : {}),
    ...(typeof published === "string" || typeof published === "number"
      ? { publishedVersionID: String(published) }
      : {}),
  };
};

type ProjectWorkspace = (value: unknown) => WorkspaceRecord | undefined;
const projectWorkspace: ProjectWorkspace = (value) => {
  if (!isRawRow(value)) return undefined;
  const id = toID(value);
  return id === undefined ? undefined : { id, label: toLabel(value, id) };
};

type NormalizeOptionalID = (value: unknown) => string | undefined;
const normalizeOptionalID: NormalizeOptionalID = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

type IsNumericFolderID = (id: string) => boolean;
const isNumericFolderID: IsNumericFolderID = (id) => /^\d+$/.test(id);

type ProjectEnvironments = (value: unknown) => readonly EnvironmentRecord[];
const projectEnvironments: ProjectEnvironments = (value) =>
  environmentValues(value).map(projectEnvironment);

type ProjectProject = (value: unknown) => ProjectRecord | undefined;
const projectProject: ProjectProject = (value) => {
  if (!isRawRow(value)) return undefined;
  const id = toID(value);
  const workspaceID = normalizeOptionalID(value.workspaceID);
  const environments = projectEnvironments(value.environments);
  return id === undefined || workspaceID === undefined
    ? undefined
    : { id, label: toLabel(value, id), workspaceID, environments };
};

type ProjectFolder = (value: unknown) => FolderRecord | undefined;
const projectFolder: ProjectFolder = (value) => {
  if (!isRawRow(value)) return undefined;
  const id = toID(value);
  const workspaceID = normalizeOptionalID(value.workspaceID);
  return id === undefined || workspaceID === undefined || !isNumericFolderID(id)
    ? undefined
    : { id, label: toLabel(value, id), workspaceID };
};

type ProjectRows = <T>(
  projector: (value: unknown) => T | undefined,
) => (rows: readonly unknown[]) => readonly T[];
const projectRows: ProjectRows = (projector) => (rows) => {
  const projectedRows = [];
  for (const row of rows) {
    const projected = projector(row);
    if (projected !== undefined) projectedRows.push(projected);
  }
  return projectedRows;
};

type NormalizeID = (value: string) => string;
const normalizeID: NormalizeID = (value) => {
  if (typeof value !== "string" || !value.trim())
    throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
};

type NormalizeIDAsync = (value: string) => Promise<string>;
const normalizeIDAsync: NormalizeIDAsync = (value) =>
  Promise.resolve().then(() => normalizeID(value));

type ProjectOptionValues = (
  rows: readonly Readonly<{ id: string; label: string }>[],
) => Option[];
const projectOptionValues: ProjectOptionValues = (rows) =>
  rows.map((row) => ({ value: row.id, label: row.label }));

type SortOptionsByLabel = (options: readonly Option[]) => Option[];
const sortOptionsByLabel: SortOptionsByLabel = (options) =>
  [...options].sort((left, right) => left.label.localeCompare(right.label));

type BuildOptions = (
  rows: readonly Readonly<{ id: string; label: string }>[],
) => Option[];
const buildOptions: BuildOptions = (rows) =>
  sortOptionsByLabel(projectOptionValues(rows));

type SelectProjectsInWorkspace = (
  rows: readonly ProjectRecord[],
  workspaceID: string,
) => readonly ProjectRecord[];
const selectProjectsInWorkspace: SelectProjectsInWorkspace = (
  rows,
  workspaceID,
) => rows.filter((row) => row.workspaceID === workspaceID);

type SelectFoldersInWorkspace = (
  rows: readonly FolderRecord[],
  workspaceID: string,
) => readonly FolderRecord[];
const selectFoldersInWorkspace: SelectFoldersInWorkspace = (
  rows,
  workspaceID,
) =>
  rows.filter(
    (row) => row.workspaceID === workspaceID && isNumericFolderID(row.id),
  );

type LoadCatalogRows = (
  auth: AuthContext,
  wanted: readonly string[],
) => (workspaceID: string) => Promise<readonly RawRow[]>;
const loadCatalogRows: LoadCatalogRows = (auth, wanted) => (workspaceID) =>
  syncCatalog(auth, `workspace/${workspaceID}`, wanted);

type BuildVersionOptions = (
  project: ProjectRecord,
  environment: EnvironmentRecord,
) => Option[];
const buildVersionOptions: BuildVersionOptions = (project, environment) =>
  VERSION_KINDS.flatMap(([key, prefix]) => {
    const value = environment[key];
    return value === undefined
      ? []
      : [
          {
            value,
            label: `${prefix} ${project.label} — ${environment.label}`,
          },
        ];
  });

type LoadWorkspaces = (
  auth: AuthContext,
) => Promise<readonly WorkspaceRecord[]>;
export const loadWorkspaces: LoadWorkspaces = (auth) =>
  syncCatalog(auth, `creator/${auth.creatorID}`, [
    "workspace.CRUD:REPLACE",
  ]).then(projectRows(projectWorkspace));

type LoadProjects = (
  auth: AuthContext,
  workspaceID: string,
) => Promise<readonly ProjectRecord[]>;
export const loadProjects: LoadProjects = (auth, workspaceID) =>
  normalizeIDAsync(workspaceID)
    .then(loadCatalogRows(auth, ["project.CRUD:REPLACE"]))
    .then(projectRows(projectProject));

type LoadFolders = (
  auth: AuthContext,
  workspaceID: string,
) => Promise<readonly FolderRecord[]>;
export const loadFolders: LoadFolders = (auth, workspaceID) =>
  normalizeIDAsync(workspaceID)
    .then(loadCatalogRows(auth, ["workspace-folder.REPLACE"]))
    .then(projectRows(projectFolder));

type WorkspaceOptions = (rows: readonly WorkspaceRecord[]) => Option[];
export const workspaceOptions: WorkspaceOptions = buildOptions;

type ProjectOptions = (
  workspaceID: string,
) => (rows: readonly ProjectRecord[]) => Option[];
export const projectOptions: ProjectOptions = (workspaceID) => (rows) => {
  const id = normalizeID(workspaceID);
  return buildOptions(selectProjectsInWorkspace(rows, id));
};

type FolderOptions = (
  workspaceID: string,
) => (rows: readonly FolderRecord[]) => Option[];
export const folderOptions: FolderOptions = (workspaceID) => (rows) => {
  const id = normalizeID(workspaceID);
  return buildOptions(selectFoldersInWorkspace(rows, id));
};

type VersionOptions = (
  workspaceID: string,
  projectID: string,
) => (rows: readonly ProjectRecord[]) => Option[];
export const versionOptions: VersionOptions =
  (workspaceID, projectID) => (rows) => {
    const workspace = normalizeID(workspaceID);
    const id = normalizeID(projectID);
    const project = rows.find(
      (row) => row.id === id && row.workspaceID === workspace,
    );
    if (!project) throw new OperationFault("NOT_FOUND");
    const options = project.environments.flatMap((environment) =>
      buildVersionOptions(project, environment),
    );
    return sortOptionsByLabel(options);
  };

type VersionOptionsForSelection = (
  workspaceID: string,
  projectID: string,
) => (rows: readonly ProjectRecord[]) => Option[];
const versionOptionsForSelection: VersionOptionsForSelection = versionOptions;

type ListWorkspaces = (auth: AuthContext) => Promise<Option[]>;
export const listWorkspaces: ListWorkspaces = (auth) =>
  loadWorkspaces(auth).then(workspaceOptions);

type ListProjects = (
  auth: AuthContext,
  workspaceID: string,
) => Promise<Option[]>;
export const listProjects: ListProjects = (auth, workspaceID) =>
  loadProjects(auth, workspaceID).then(projectOptions(workspaceID));

type ListFolders = (
  auth: AuthContext,
  workspaceID: string,
) => Promise<Option[]>;
export const listFolders: ListFolders = (auth, workspaceID) =>
  loadFolders(auth, workspaceID).then(folderOptions(workspaceID));

type ListVersions = (
  auth: AuthContext,
  workspaceID: string,
  projectID: string,
) => Promise<Option[]>;
export const listVersions: ListVersions = (auth, workspaceID, projectID) =>
  loadProjects(auth, workspaceID).then(
    versionOptionsForSelection(workspaceID, projectID),
  );
