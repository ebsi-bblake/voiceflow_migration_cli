import { isNumericFolderID, isRawRow } from "../guards";
import type {
  EnvironmentRecord,
  FolderRecord,
  ProjectRecord,
  WorkspaceRecord,
} from "../types";

export type RawCatalogRow = Readonly<Record<string, unknown>>;
export type CatalogParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "invalid-row" };

type VersionField = "draftVersionID" | "publishedVersionID";
type ProjectRows = <T>(
  parser: (value: unknown) => CatalogParseResult<T>,
) => (rows: readonly unknown[]) => readonly T[];

const invalidRow: CatalogParseResult<never> = {
  ok: false,
  reason: "invalid-row",
};

const validRow = <T>(value: T): CatalogParseResult<T> => ({ ok: true, value });

// Runtime validation intentionally handles multiple external representations.
// oxlint-disable-next-line complexity
const normalizeOptionalID = (value: unknown): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const readID = (row: RawCatalogRow): string | undefined =>
  normalizeOptionalID(row.id ?? row._id);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

// Voiceflow has historically emitted several label aliases.
// oxlint-disable-next-line complexity
const readLabel = (row: RawCatalogRow, fallback: string): string => {
  const candidate = [row.name, row.title, row.label].find(isNonEmptyString);
  return candidate?.trim() ?? fallback;
};

// Catalog environments arrive as either arrays or keyed objects.
// oxlint-disable-next-line complexity
const readEnvironmentRows = (value: unknown): readonly RawCatalogRow[] => {
  if (Array.isArray(value)) return value.filter(isRawRow);
  if (!isRawRow(value)) return [];
  return Object.values(value).filter(isRawRow);
};

const isVersionValue = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

const readOptionalVersion = (
  key: VersionField,
  value: unknown,
): Partial<EnvironmentRecord> =>
  isVersionValue(value) ? { [key]: String(value) } : {};

const readEnvironment = (row: RawCatalogRow): EnvironmentRecord => ({
  label: readLabel(row, "Environment"),
  ...readOptionalVersion("draftVersionID", row.draftVersionID),
  ...readOptionalVersion("publishedVersionID", row.publishedVersionID),
});

const readEnvironments = (value: unknown): readonly EnvironmentRecord[] =>
  readEnvironmentRows(value).map(readEnvironment);

type ParseWorkspace = (value: unknown) => CatalogParseResult<WorkspaceRecord>;
// Runtime validation establishes the WorkspaceRecord contract before catalog options are built.
// oxlint-disable-next-line complexity
export const parseWorkspace: ParseWorkspace = (value) => {
  if (!isRawRow(value)) return invalidRow;
  const id = readID(value);
  if (id === undefined) return invalidRow;
  return validRow({ id, label: readLabel(value, id) });
};

// oxlint-disable-next-line complexity
const parseProject: (value: unknown) => CatalogParseResult<ProjectRecord> = (
  value,
) => {
  if (!isRawRow(value)) return invalidRow;
  const id = readID(value);
  const workspaceID = normalizeOptionalID(value.workspaceID);
  if (id === undefined || workspaceID === undefined) return invalidRow;
  return validRow({
    id,
    label: readLabel(value, id),
    workspaceID,
    environments: readEnvironments(value.environments),
  });
};

// oxlint-disable-next-line complexity
const parseFolder: (value: unknown) => CatalogParseResult<FolderRecord> = (
  value,
) => {
  if (!isRawRow(value)) return invalidRow;
  const id = readID(value);
  const workspaceID = normalizeOptionalID(value.workspaceID);
  if (id === undefined || workspaceID === undefined || !isNumericFolderID(id))
    return invalidRow;
  return validRow({ id, label: readLabel(value, id), workspaceID });
};

export const projectRows: ProjectRows = (parser) => (rows) =>
  rows.flatMap((row) => {
    const result = parser(row);
    return result.ok ? [result.value] : [];
  });

export { parseFolder, parseProject };
