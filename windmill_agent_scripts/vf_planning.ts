import {
  folderOptions,
  loadFolders,
  loadProjects,
  loadWorkspaces,
  projectOptions,
  versionOptions,
  workspaceOptions,
  type Option,
} from "./vf_catalog";
import type { AuthContext } from "./vf_auth";
import {
  OperationFault,
  type MigrationPlan,
  type MigrationSelection,
} from "./vf_contracts";
import { parseFolderID, parseProjectID, parseSchemaVersion, parseVersionID, parseWorkspaceID } from "./vf_validation";



export function normalizeMigrationSelection(
  input: MigrationSelection,
): MigrationSelection {
  return {
    sourceWorkspaceID: parseWorkspaceID(input.sourceWorkspaceID),
    sourceProjectID: parseProjectID(input.sourceProjectID),
    sourceVersionID: parseVersionID(input.sourceVersionID),
    destinationWorkspaceID: parseWorkspaceID(input.destinationWorkspaceID),
    destinationFolderID: parseFolderID(input.destinationFolderID),
    targetSchemaVersion: parseSchemaVersion(input.targetSchemaVersion),
  };
}

function findLabel(options: Option[], value: string): string {
  const option = options.find((item) => item.value === value);
  if (!option) throw new OperationFault("NOT_FOUND");
  return option.label;
}

async function planID(selection: MigrationSelection): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(selection));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

export async function buildMigrationPlan(
  auth: AuthContext,
  input: MigrationSelection,
): Promise<MigrationPlan> {
  const selection = normalizeMigrationSelection(input);
  const [workspaces, projects, folders] = await Promise.all([
    loadWorkspaces(auth),
    loadProjects(auth, selection.sourceWorkspaceID),
    loadFolders(auth, selection.destinationWorkspaceID),
  ]);
  const workspaceChoices = workspaceOptions(workspaces);
  const projectChoices = projectOptions(projects, selection.sourceWorkspaceID);
  const versionChoices = versionOptions(
    projects,
    selection.sourceWorkspaceID,
    selection.sourceProjectID,
  );
  const folderChoices = folderOptions(
    folders,
    selection.destinationWorkspaceID,
  );
  return {
    planID: await planID(selection),
    selection,
    labels: {
      sourceWorkspace: findLabel(workspaceChoices, selection.sourceWorkspaceID),
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
}
