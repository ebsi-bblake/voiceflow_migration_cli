import type { AuthContext } from "./types";
import { syncCatalog } from "./vf_logux";
import { OperationFault } from "./vf_contracts";
import { requireVoiceflowString } from "./vf_validation";
import { isNumericFolderID, isRawRow } from "./guards";
import type {
  EnvironmentRecord, FolderRecord, Option, ProjectRecord, WorkspaceRecord,
} from "./types";
export type { EnvironmentRecord, FolderRecord, Option, ProjectRecord, WorkspaceRecord } from "./types";
type RawRow = Readonly<Record<string, unknown>>;
type VersionField = "draftVersionID" | "publishedVersionID";
type VersionKind = readonly [VersionField, string];

const VERSION_KINDS: readonly VersionKind[] = [
  ["draftVersionID", "[Draft]"],
  ["publishedVersionID", "[Published]"],
];

type ToID = (row: RawRow) => string | undefined;
const toID: ToID = (row) => {
  return normalizeOptionalID(row.id ?? row._id);
};

type ToLabel = (row: RawRow, fallback: string) => string;
const toLabel: ToLabel = (row, fallback) => {
  const candidate = ["name", "title", "label"].map((key) => row[key]).find(isNonEmptyString);
  return candidate === undefined ? fallback : candidate.trim();
};
const isNonEmptyString = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  return value.trim() !== "";
};

type EnvironmentValues = (value: unknown) => readonly RawRow[];
const environmentValues: EnvironmentValues = (value) => {
  return Array.isArray(value) ? value.filter(isRawRow) : objectEnvironmentValues(value);
};
const objectEnvironmentValues = (value: unknown): readonly RawRow[] =>
  isRawRow(value) ? Object.values(value).filter(isRawRow) : [];

type ProjectEnvironment = (value: RawRow) => EnvironmentRecord;
const projectEnvironment: ProjectEnvironment = (value) => {
  const draft = value.draftVersionID;
  const published = value.publishedVersionID;
  return {
    label: toLabel(value, "Environment"),
    ...optionalVersion("draftVersionID", draft),
    ...optionalVersion("publishedVersionID", published),
  };
};
const optionalVersion = (key: VersionField, value: unknown): Partial<EnvironmentRecord> => {
  if (!isVersionValue(value)) return {};
  return { [key]: String(value) };
};
const isVersionValue = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";


type ProjectWorkspace = (value: unknown) => WorkspaceRecord | undefined;
const projectWorkspace: ProjectWorkspace = (value) => {
  return projectWorkspaceRow(isRawRow(value) ? value : undefined);
};
const projectWorkspaceRow = (value: RawRow | undefined): WorkspaceRecord | undefined => {
  if (value === undefined) return undefined;
  return projectWorkspaceIdentity(value);
};
const projectWorkspaceIdentity = (value: RawRow): WorkspaceRecord | undefined => {
  const id = toID(value);
  if (id === undefined) return undefined;
  return { id, label: toLabel(value, id) };
};

type NormalizeOptionalID = (value: unknown) => string | undefined;
const normalizeOptionalID: NormalizeOptionalID = (value) => {
  return isStringOrNumber(value) ? normalizeID(value) : undefined;
};
const normalizeID = (value: string | number): string | undefined => {
  const normalized = String(value).trim();
  return normalized === "" ? undefined : normalized;
};
const isStringOrNumber = (value: unknown): value is string | number => {
  if (typeof value === "string") return true;
  return typeof value === "number";
};

type ProjectEnvironments = (value: unknown) => readonly EnvironmentRecord[];
const projectEnvironments: ProjectEnvironments = (value) =>
  environmentValues(value).map(projectEnvironment);

type ProjectProject = (value: unknown) => ProjectRecord | undefined;
const projectProject: ProjectProject = (value) => {
  return projectProjectRow(isRawRow(value) ? value : undefined);
};
const projectProjectRow = (value: RawRow | undefined): ProjectRecord | undefined => {
  if (value === undefined) return undefined;
  return projectProjectRecord(value);
};
const projectProjectRecord = (value: RawRow): ProjectRecord | undefined => {
  const ids = { id: toID(value), workspaceID: normalizeOptionalID(value.workspaceID) };
  const environments = projectEnvironments(value.environments);
  if (!hasProjectIDs(ids)) return undefined;
  const { id, workspaceID } = ids;
  return { id, label: toLabel(value, id), workspaceID, environments };
};
const hasProjectIDs = (
  ids: { id: string | undefined; workspaceID: string | undefined },
): ids is { id: string; workspaceID: string } =>
  ids.id !== undefined && ids.workspaceID !== undefined;

type ProjectFolder = (value: unknown) => FolderRecord | undefined;
const projectFolder: ProjectFolder = (value) => {
  return projectFolderRow(isRawRow(value) ? value : undefined);
};
const projectFolderRow = (value: RawRow | undefined): FolderRecord | undefined => {
  if (value === undefined) return undefined;
  return projectFolderRecord(value);
};
const projectFolderRecord = (value: RawRow): FolderRecord | undefined => {
  const ids = { id: toID(value), workspaceID: normalizeOptionalID(value.workspaceID) };
  if (!isValidFolderProjection(ids)) return undefined;
  const { id, workspaceID } = ids;
  return { id, label: toLabel(value, id), workspaceID };
};
const isValidFolderProjection = (
  ids: { id: string | undefined; workspaceID: string | undefined },
): ids is { id: string; workspaceID: string } =>
  [ids.id !== undefined, ids.workspaceID !== undefined, ids.id !== undefined && isNumericFolderID(ids.id)]
    .every(Boolean);

type ProjectRows = <T>(
  projector: (value: unknown) => T | undefined,
) => (rows: readonly unknown[]) => readonly T[];
const projectRows: ProjectRows = (projector) => (rows) => {
  return rows.flatMap((row) => {
    const projected = projector(row);
    return projected === undefined ? [] : [projected];
  });
};

type NormalizeIDAsync = (value: string) => Promise<string>;
const normalizeIDAsync: NormalizeIDAsync = (value) =>
  Promise.resolve().then(() => requireVoiceflowString(value));

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
  const id = requireVoiceflowString(workspaceID);
  return buildOptions(selectProjectsInWorkspace(rows, id));
};

type FolderOptions = (
  workspaceID: string,
) => (rows: readonly FolderRecord[]) => Option[];
export const folderOptions: FolderOptions = (workspaceID) => (rows) => {
  const id = requireVoiceflowString(workspaceID);
  return buildOptions(selectFoldersInWorkspace(rows, id));
};

type VersionOptions = (
  workspaceID: string,
  projectID: string,
) => (rows: readonly ProjectRecord[]) => Option[];
export const versionOptions: VersionOptions =
  (workspaceID, projectID) => (rows) => {
    const workspace = requireVoiceflowString(workspaceID);
    const id = requireVoiceflowString(projectID);
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
