import type { AuthContext } from "./vf_auth";
import { syncCatalog } from "./vf_logux";
import { OperationFault } from "./vf_contracts";

export type Option = { value: string; label: string };
type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function environmentRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter(isRow);
  if (!isRow(value)) return [];
  return Object.values(value).filter(isRow);
}

function rowID(row: Row): string | undefined {
  const value = row.id ?? row._id;
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function rowLabel(row: Row, fallback: string): string {
  const value = row.name ?? row.title ?? row.label;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function belongsToWorkspace(row: Row, workspaceID: string): boolean {
  return String(row.workspaceID ?? "") === workspaceID;
}

function hasNumericFolderID(row: Row): boolean {
  const value = rowID(row);
  return value !== undefined && /^\d+$/.test(value);
}

function normalizeID(value: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
}

function buildOptions(rows: Row[]): Option[] {
  const options = rows.flatMap((row) => {
    const value = rowID(row);
    return value ? [{ value, label: rowLabel(row, value) }] : [];
  });
  return options.sort((left, right) => left.label.localeCompare(right.label));
}

export async function loadWorkspaces(auth: AuthContext): Promise<Row[]> {
  const value = await syncCatalog(auth, `creator/${auth.creatorID}`, [
    "workspace.CRUD:REPLACE",
  ]);
  return toRows(value);
}

export async function loadProjects(
  auth: AuthContext,
  workspaceID: string,
): Promise<Row[]> {
  const id = normalizeID(workspaceID);
  return toRows(
    await syncCatalog(auth, `workspace/${id}`, ["project.CRUD:REPLACE"]),
  );
}

export async function loadFolders(
  auth: AuthContext,
  workspaceID: string,
): Promise<Row[]> {
  const id = normalizeID(workspaceID);
  return toRows(
    await syncCatalog(auth, `workspace/${id}`, ["workspace-folder.REPLACE"]),
  );
}

export function workspaceOptions(rows: Row[]): Option[] {
  return buildOptions(rows);
}

export function projectOptions(rows: Row[], workspaceID: string): Option[] {
  const id = normalizeID(workspaceID);
  return buildOptions(rows.filter((row) => belongsToWorkspace(row, id)));
}

export function folderOptions(rows: Row[], workspaceID: string): Option[] {
  const id = normalizeID(workspaceID);
  return buildOptions(
    rows.filter(
      (row) => belongsToWorkspace(row, id) && hasNumericFolderID(row),
    ),
  );
}

export function versionOptions(
  rows: Row[],
  workspaceID: string,
  projectID: string,
): Option[] {
  const workspace = normalizeID(workspaceID);
  const id = normalizeID(projectID);
  const project = rows.find(
    (row) => rowID(row) === id && belongsToWorkspace(row, workspace),
  );
  if (!project) throw new OperationFault("NOT_FOUND");
  return environmentRows(project.environments).flatMap((environment) =>
    buildVersionOptions(project, environment),
  );
}

function buildVersionOptions(project: Row, environment: Row): Option[] {
  const versions = [
    ["draftVersionID", "[Draft]"],
    ["publishedVersionID", "[Published]"],
  ] as const;
  return versions.flatMap(([key, prefix]) => {
    const value = environment[key];
    return typeof value === "string" || typeof value === "number"
      ? [
          {
            value: String(value),
            label: `${prefix} ${rowLabel(project, "Project")} — ${rowLabel(environment, "Environment")}`,
          },
        ]
      : [];
  });
}

export async function listWorkspaces(auth: AuthContext): Promise<Option[]> {
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
