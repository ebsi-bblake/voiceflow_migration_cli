import {
  folderOptions,
  loadFolders,
  loadProjects,
  loadWorkspaces,
  projectOptions,
  versionOptions,
  workspaceOptions,
  type Option,
  type FolderRecord,
  type ProjectRecord,
  type WorkspaceRecord,
} from "./vf_catalog";
import type { AuthContext } from "./vf_auth";
import {
  OperationFault,
  type MigrationPlan,
  type MigrationSelection,
} from "./vf_contracts";

type Required = (value: unknown) => string;
const required: Required = (value) => {
  if (typeof value !== "string" || !value.trim())
    throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
};

type NormalizeMigrationSelection = (
  input: MigrationSelection,
) => MigrationSelection;
export const normalizeMigrationSelection: NormalizeMigrationSelection = (
  input,
) => ({
  sourceWorkspaceID: required(input?.sourceWorkspaceID),
  sourceProjectID: required(input?.sourceProjectID),
  sourceVersionID: required(input?.sourceVersionID),
  destinationWorkspaceID: required(input?.destinationWorkspaceID),
  destinationFolderID: required(input?.destinationFolderID),
  targetSchemaVersion: required(input?.targetSchemaVersion),
});

type FindLabel = (options: readonly Option[], value: string) => string;
const findLabel: FindLabel = (options, value) => {
  const option = options.find((item) => item.value === value);
  if (!option) throw new OperationFault("NOT_FOUND");
  return option.label;
};

type FormatPlanID = (bytes: ArrayBuffer) => string;
const formatPlanID: FormatPlanID = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);

type PlanID = (selection: MigrationSelection) => Promise<string>;
const planID: PlanID = (selection) => {
  const bytes = new TextEncoder().encode(JSON.stringify(selection));
  return crypto.subtle.digest("SHA-256", bytes).then(formatPlanID);
};

type CatalogSnapshot = readonly [
  readonly WorkspaceRecord[],
  readonly ProjectRecord[],
  readonly FolderRecord[],
];

type LoadCatalogForSelection = (
  auth: AuthContext,
) => (selection: MigrationSelection) => Promise<CatalogSnapshot>;
const loadCatalogForSelection: LoadCatalogForSelection = (auth) =>
  (selection) =>
    Promise.all([
      loadWorkspaces(auth),
      loadProjects(auth, selection.sourceWorkspaceID),
      loadFolders(auth, selection.destinationWorkspaceID),
    ]);

type CreatePlanFromCatalog = (
  selection: MigrationSelection,
  catalog: CatalogSnapshot,
) => (planID: string) => MigrationPlan;
const createPlanFromCatalog: CreatePlanFromCatalog =
  (selection, [workspaces, projects, folders]) => (planID) => {
    const workspaceChoices = workspaceOptions(workspaces);
    const projectChoices = projectOptions(selection.sourceWorkspaceID)(
      projects,
    );
    const versionChoices = versionOptions(
      selection.sourceWorkspaceID,
      selection.sourceProjectID,
    )(projects);
    const folderChoices = folderOptions(
      selection.destinationWorkspaceID,
    )(folders);
    return {
      planID,
      selection,
      labels: {
        sourceWorkspace: findLabel(
          workspaceChoices,
          selection.sourceWorkspaceID,
        ),
        sourceProject: findLabel(projectChoices, selection.sourceProjectID),
        sourceVersion: findLabel(versionChoices, selection.sourceVersionID),
        destinationWorkspace: findLabel(
          workspaceChoices,
          selection.destinationWorkspaceID,
        ),
        destinationFolder: findLabel(
          folderChoices,
          selection.destinationFolderID,
        ),
      },
    };
  };

type BuildPlanFromSelection = (
  auth: AuthContext,
) => (selection: MigrationSelection) => Promise<MigrationPlan>;
type PlanCatalogSelection = (
  selection: MigrationSelection,
) => (catalog: CatalogSnapshot) => Promise<MigrationPlan>;
const planCatalogSelection: PlanCatalogSelection = (selection) => (catalog) =>
  planID(selection).then(createPlanFromCatalog(selection, catalog));

const buildPlanFromSelection: BuildPlanFromSelection = (auth) =>
  (selection) =>
    loadCatalogForSelection(auth)(selection).then(
      planCatalogSelection(selection),
    );

type BuildMigrationPlan = (
  auth: AuthContext,
  input: MigrationSelection,
) => Promise<MigrationPlan>;
export const buildMigrationPlan: BuildMigrationPlan = (auth, input) =>
  Promise.resolve()
    .then(() => normalizeMigrationSelection(input))
    .then(buildPlanFromSelection(auth));
