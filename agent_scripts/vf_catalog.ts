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

function isRawRow(value: unknown): value is RawRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toID(row: RawRow): string | undefined {
  const value = row.id ?? row._id;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  return id || undefined;
}
function toLabel(row: RawRow, fallback: string): string {
  for (const key of ["name", "title", "label"] as const) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}
function environmentValues(value: unknown): RawRow[] {
  if (Array.isArray(value)) return value.filter(isRawRow);
  return isRawRow(value) ? Object.values(value).filter(isRawRow) : [];
}
function projectEnvironment(value: RawRow): EnvironmentRecord {
  const draft = value.draftVersionID;
  const published = value.publishedVersionID;
  return {
    label: toLabel(value, "Environment"),
    ...(typeof draft === "string" || typeof draft === "number" ? { draftVersionID: String(draft) } : {}),
    ...(typeof published === "string" || typeof published === "number" ? { publishedVersionID: String(published) } : {}),
  };
}
function projectWorkspace(value: unknown): WorkspaceRecord | undefined {
  if (!isRawRow(value)) return undefined;
  const id = toID(value);
  return id === undefined ? undefined : { id, label: toLabel(value, id) };
}
function projectProject(value: unknown): ProjectRecord | undefined {
  if (!isRawRow(value)) return undefined;
  const id = toID(value);
  const workspaceID = normalizeOptionalID(value.workspaceID);
  const environments = projectEnvironments(value.environments);
  return id === undefined || workspaceID === undefined ? undefined :
    { id, label: toLabel(value, id), workspaceID, environments };
}
function projectFolder(value: unknown): FolderRecord | undefined {
  if (!isRawRow(value)) return undefined;
  const id = toID(value);
  const workspaceID = normalizeOptionalID(value.workspaceID);
  return id === undefined || workspaceID === undefined || !isNumericFolderID(id) ? undefined :
    { id, label: toLabel(value, id), workspaceID };
}
function normalizeOptionalID(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}
function isNumericFolderID(id: string): boolean { return /^\d+$/.test(id); }
function projectEnvironments(value: unknown): readonly EnvironmentRecord[] {
  const environments: EnvironmentRecord[] = [];
  for (const rawEnvironment of environmentValues(value)) {
    environments.push(projectEnvironment(rawEnvironment));
  }
  return environments;
}
function projectRows<T>(rows: readonly unknown[], projector: (value: unknown) => T | undefined): readonly T[] {
  const projectedRows: T[] = [];
  for (const row of rows) {
    const projected = projector(row);
    if (projected !== undefined) projectedRows.push(projected);
  }
  return projectedRows;
}
function normalizeID(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
}
function projectOptionValues(rows: readonly { id: string; label: string }[]): Option[] {
  return rows.map((row) => ({ value: row.id, label: row.label }));
}
function sortOptionsByLabel(options: readonly Option[]): Option[] {
  return [...options].sort((left, right) => left.label.localeCompare(right.label));
}
function buildOptions(rows: readonly { id: string; label: string }[]): Option[] {
  return sortOptionsByLabel(projectOptionValues(rows));
}
function selectProjectsInWorkspace(rows: readonly ProjectRecord[], workspaceID: string): readonly ProjectRecord[] {
  return rows.filter((row) => row.workspaceID === workspaceID);
}
function selectFoldersInWorkspace(rows: readonly FolderRecord[], workspaceID: string): readonly FolderRecord[] {
  return rows.filter((row) => row.workspaceID === workspaceID && isNumericFolderID(row.id));
}
export async function loadWorkspaces(auth: AuthContext): Promise<readonly WorkspaceRecord[]> {
  return projectRows(await syncCatalog(auth, `creator/${auth.creatorID}`, ["workspace.CRUD:REPLACE"]), projectWorkspace);
}
export async function loadProjects(auth: AuthContext, workspaceID: string): Promise<readonly ProjectRecord[]> {
  const id = normalizeID(workspaceID);
  return projectRows(await syncCatalog(auth, `workspace/${id}`, ["project.CRUD:REPLACE"]), projectProject);
}
export async function loadFolders(auth: AuthContext, workspaceID: string): Promise<readonly FolderRecord[]> {
  const id = normalizeID(workspaceID);
  return projectRows(await syncCatalog(auth, `workspace/${id}`, ["workspace-folder.REPLACE"]), projectFolder);
}
export function workspaceOptions(rows: readonly WorkspaceRecord[]): Option[] { return buildOptions(rows); }
export function projectOptions(rows: readonly ProjectRecord[], workspaceID: string): Option[] {
  const id = normalizeID(workspaceID);
  return buildOptions(selectProjectsInWorkspace(rows, id));
}
export function folderOptions(rows: readonly FolderRecord[], workspaceID: string): Option[] {
  const id = normalizeID(workspaceID);
  return buildOptions(selectFoldersInWorkspace(rows, id));
}
export function versionOptions(rows: readonly ProjectRecord[], workspaceID: string, projectID: string): Option[] {
  const workspace = normalizeID(workspaceID), id = normalizeID(projectID);
  const project = rows.find((row) => row.id === id && row.workspaceID === workspace);
  if (!project) throw new OperationFault("NOT_FOUND");
  const options = project.environments.flatMap((environment) =>
    buildVersionOptions(project, environment)
  );
  return sortOptionsByLabel(options);
}
function buildVersionOptions(project: ProjectRecord, environment: EnvironmentRecord): Option[] {
  return [["draftVersionID", "[Draft]"], ["publishedVersionID", "[Published]"]].flatMap(([key, prefix]) => {
    const value = environment[key as "draftVersionID" | "publishedVersionID"];
    return value === undefined ? [] : [{ value, label: `${prefix} ${project.label} — ${environment.label}` }];
  });
}
export async function listWorkspaces(auth: AuthContext): Promise<Option[]> {
  return workspaceOptions(await loadWorkspaces(auth));
}
export async function listProjects(auth: AuthContext, workspaceID: string): Promise<Option[]> {
  return projectOptions(await loadProjects(auth, workspaceID), workspaceID);
}
export async function listFolders(auth: AuthContext, workspaceID: string): Promise<Option[]> {
  return folderOptions(await loadFolders(auth, workspaceID), workspaceID);
}
export async function listVersions(auth: AuthContext, workspaceID: string, projectID: string): Promise<Option[]> {
  return versionOptions(await loadProjects(auth, workspaceID), workspaceID, projectID);
}
