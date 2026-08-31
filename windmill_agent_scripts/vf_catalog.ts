import type { AuthContext } from "./vf_auth";
import { syncCatalog } from "./vf_logux";
import { OperationFault } from "./vf_contracts";

export type Option = { value: string; label: string };
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

type RawRow = Record<string, unknown>;
type VersionField = "draftVersionID" | "publishedVersionID";
type VersionKind = readonly [VersionField, string];
const versionKinds: readonly VersionKind[] = [
  ["draftVersionID", "[Draft]"],
  ["publishedVersionID", "[Published]"],
];

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isRawRow(value: unknown): value is RawRow {
  return isObject(value) && !Array.isArray(value);
}

function isStringOrNumber(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function normalizeOptionalID(value: unknown): string | undefined {
  return isStringOrNumber(value) ? normalizeIDValue(value) : undefined;
}

function normalizeIDValue(value: string | number): string | undefined {
  const normalized = String(value).trim();
  return normalized || undefined;
}

function toID(row: RawRow): string | undefined {
  return normalizeOptionalID(row.id ?? row._id);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toLabel(row: RawRow, fallback: string): string {
  const candidate = [row.name, row.title, row.label].find(isNonEmptyString);
  if (candidate === undefined) return fallback;
  return candidate.trim();
}

function environmentValues(value: unknown): RawRow[] {
  if (Array.isArray(value)) return value.filter(isRawRow);
  return objectEnvironmentValues(value);
}

function objectEnvironmentValues(value: unknown): RawRow[] {
  return isRawRow(value) ? Object.values(value).filter(isRawRow) : [];
}

function versionValue(value: unknown): string | undefined {
  return isStringOrNumber(value) ? String(value) : undefined;
}

function projectEnvironment(value: RawRow): EnvironmentRecord {
  return {
    label: toLabel(value, "Environment"),
    ...optionalVersion("draftVersionID", value.draftVersionID),
    ...optionalVersion("publishedVersionID", value.publishedVersionID),
  };
}

function optionalVersion(
  key: VersionField,
  value: unknown,
): Partial<EnvironmentRecord> {
  const version = versionValue(value);
  return version === undefined ? {} : { [key]: version };
}

function projectEnvironments(value: unknown): readonly EnvironmentRecord[] {
  return environmentValues(value).map(projectEnvironment);
}

function workspaceRecord(row: RawRow, id: string): WorkspaceRecord {
  return { id, label: toLabel(row, id) };
}

function parseOptionalRecord<T>(
  value: unknown,
  parser: (row: RawRow) => T | undefined,
): T | undefined {
  if (!isRawRow(value)) return undefined;
  return parser(value);
}

function parseWorkspaceRow(row: RawRow): WorkspaceRecord | undefined {
  const id = toID(row);
  return id === undefined ? undefined : workspaceRecord(row, id);
}

function projectWorkspace(value: unknown): WorkspaceRecord | undefined {
  return parseOptionalRecord(value, parseWorkspaceRow);
}

function projectRecord(
  row: RawRow,
  id: string,
  workspaceID: string,
): ProjectRecord {
  return {
    id,
    label: toLabel(row, id),
    workspaceID,
    environments: projectEnvironments(row.environments),
  };
}

type CatalogIDs = Readonly<{ id: string; workspaceID: string }>;

// This boundary must preserve row omission while narrowing both IDs together.
// oxlint-disable-next-line complexity
function readCatalogIDs(row: RawRow): CatalogIDs | undefined {
  const id = toID(row);
  const workspaceID = normalizeOptionalID(row.workspaceID);
  if (id === undefined) return undefined;
  if (workspaceID === undefined) return undefined;
  return { id, workspaceID };
}

function parseProjectRow(row: RawRow): ProjectRecord | undefined {
  const ids = readCatalogIDs(row);
  if (ids === undefined) return undefined;
  return projectRecord(row, ids.id, ids.workspaceID);
}

function projectProject(value: unknown): ProjectRecord | undefined {
  return parseOptionalRecord(value, parseProjectRow);
}

function folderRecord(
  row: RawRow,
  id: string,
  workspaceID: string,
): FolderRecord {
  return { id, label: toLabel(row, id), workspaceID };
}

function parseFolderRow(row: RawRow): FolderRecord | undefined {
  const ids = readCatalogIDs(row);
  if (!validFolderIDs(ids)) return undefined;
  return folderRecord(row, ids.id, ids.workspaceID);
}

function projectFolder(value: unknown): FolderRecord | undefined {
  return parseOptionalRecord(value, parseFolderRow);
}

function validFolderIDs(ids: CatalogIDs | undefined): ids is CatalogIDs {
  if (ids === undefined) return false;
  return isNumericFolderID(ids.id);
}

function isNumericFolderID(id: string): boolean {
  return /^\d+$/.test(id);
}

function projectRows<T>(
  rows: readonly unknown[],
  projector: (value: unknown) => T | undefined,
): readonly T[] {
  return rows.flatMap((row) => projectedRow(projector(row)));
}

function projectedRow<T>(value: T | undefined): readonly T[] {
  return value === undefined ? [] : [value];
}

function normalizeID(value: string): string {
  if (!isNonEmptyString(value)) throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
}

function projectOptionValues(
  rows: readonly { id: string; label: string }[],
): Option[] {
  return rows.map((row) => ({ value: row.id, label: row.label }));
}

function sortOptionsByLabel(options: readonly Option[]): Option[] {
  return [...options].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function buildOptions(
  rows: readonly { id: string; label: string }[],
): Option[] {
  return sortOptionsByLabel(projectOptionValues(rows));
}

function selectProjectsInWorkspace(
  rows: readonly ProjectRecord[],
  workspaceID: string,
): readonly ProjectRecord[] {
  return rows.filter((row) => row.workspaceID === workspaceID);
}

function selectFoldersInWorkspace(
  rows: readonly FolderRecord[],
  workspaceID: string,
): readonly FolderRecord[] {
  return rows.filter(
    (row) => row.workspaceID === workspaceID && isNumericFolderID(row.id),
  );
}

export async function loadWorkspaces(
  auth: AuthContext,
): Promise<readonly WorkspaceRecord[]> {
  const rows = await syncCatalog(auth, `creator/${auth.creatorID}`, [
    "workspace.CRUD:REPLACE",
  ]);
  return projectRows(rows, projectWorkspace);
}

export async function loadProjects(
  auth: AuthContext,
  workspaceID: string,
): Promise<readonly ProjectRecord[]> {
  const id = normalizeID(workspaceID);
  const rows = await syncCatalog(auth, `workspace/${id}`, [
    "project.CRUD:REPLACE",
  ]);
  return projectRows(rows, projectProject);
}

export async function loadFolders(
  auth: AuthContext,
  workspaceID: string,
): Promise<readonly FolderRecord[]> {
  const id = normalizeID(workspaceID);
  const rows = await syncCatalog(auth, `workspace/${id}`, [
    "workspace-folder.REPLACE",
  ]);
  return projectRows(rows, projectFolder);
}

export function workspaceOptions(
  rows: readonly WorkspaceRecord[],
): Option[] {
  return buildOptions(rows);
}

export function projectOptions(
  rows: readonly ProjectRecord[],
  workspaceID: string,
): Option[] {
  return buildOptions(selectProjectsInWorkspace(rows, normalizeID(workspaceID)));
}

export function folderOptions(
  rows: readonly FolderRecord[],
  workspaceID: string,
): Option[] {
  return buildOptions(selectFoldersInWorkspace(rows, normalizeID(workspaceID)));
}

export function versionOptions(
  rows: readonly ProjectRecord[],
  workspaceID: string,
  projectID: string,
): Option[] {
  const workspace = normalizeID(workspaceID);
  const id = normalizeID(projectID);
  const project = rows.find(
    (row) => row.id === id && row.workspaceID === workspace,
  );
  if (!project) throw new OperationFault("NOT_FOUND");
  return sortOptionsByLabel(
    project.environments.flatMap((environment) =>
      buildVersionOptions(project, environment),
    ),
  );
}

function buildVersionOptions(
  project: ProjectRecord,
  environment: EnvironmentRecord,
): Option[] {
  return versionKinds.flatMap(([key, prefix]) => {
    const value = environment[key];
    return value === undefined
      ? []
      : [{ value, label: `${prefix} ${project.label} — ${environment.label}` }];
  });
}

export async function listWorkspaces(
  auth: AuthContext,
): Promise<Option[]> {
  return workspaceOptions(await loadWorkspaces(auth));
}

export async function listProjects(
  auth: AuthContext,
  workspaceID: string,
): Promise<Option[]> {
  return projectOptions(await loadProjects(auth, workspaceID), workspaceID);
}

export async function listFolders(
  auth: AuthContext,
  workspaceID: string,
): Promise<Option[]> {
  return folderOptions(await loadFolders(auth, workspaceID), workspaceID);
}

export async function listVersions(
  auth: AuthContext,
  workspaceID: string,
  projectID: string,
): Promise<Option[]> {
  return versionOptions(
    await loadProjects(auth, workspaceID),
    workspaceID,
    projectID,
  );
}
