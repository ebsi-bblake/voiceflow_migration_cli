import type {
  EventParameterValue,
  EventParameters,
  MigrationSelection,
  Option,
} from "./types";
import { isEventParameterEntry } from "./guards";
import type { MigrationState } from "./types";
export type { MigrationState } from "./types";

type InitialMigrationState = () => MigrationState;
export const initialMigrationState: InitialMigrationState = () => ({
  targetSchemaVersion: "13.1",
});

type SetStateValue = <K extends keyof MigrationState>(
  state: MigrationState,
  key: K,
  value: MigrationState[K],
) => MigrationState;
export const setStateValue: SetStateValue = (state, key, value) => ({
  ...state,
  [key]: value,
});

type RequireStateValue = (
  state: MigrationState,
  key: keyof MigrationState,
) => string;
const isPresentStateValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";
export const requireStateValue: RequireStateValue = (state, key) => {
  const value = state[key];
  if (!isPresentStateValue(value))
    throw new Error(`Missing state value: ${key}`);
  return value;
};

type StateSelection = (state: MigrationState) => MigrationSelection;
export const stateSelection: StateSelection = (state) => ({
  sourceWorkspaceID: requireStateValue(state, "sourceWorkspaceID"),
  sourceProjectID: requireStateValue(state, "sourceProjectID"),
  sourceVersionID: requireStateValue(state, "sourceVersionID"),
  destinationWorkspaceID: requireStateValue(state, "destinationWorkspaceID"),
  destinationFolderID: requireStateValue(state, "destinationFolderID"),
  targetSchemaVersion: requireStateValue(state, "targetSchemaVersion"),
});

type ChooseOptionValue = (
  options: readonly Option[],
  index: number,
) => string | undefined;
export const chooseOptionValue: ChooseOptionValue = (options, index) =>
  options[index]?.value;

type EventParametersFor = (
  operation: string,
  values?: Readonly<Record<string, EventParameterValue | undefined>>,
) => EventParameters;
export const eventParametersFor: EventParametersFor = (
  operation,
  values = {},
) =>
  Object.fromEntries(
    Object.entries({ operation, ...values } as Record<
      string,
      EventParameterValue | undefined
    >).filter(isEventParameterEntry),
  );

type ListWorkspacesParameters = () => EventParameters;
export const listWorkspacesParameters: ListWorkspacesParameters = () =>
  eventParametersFor("list-workspaces");

type ListProjectsParameters = (sourceWorkspaceID: string) => EventParameters;
export const listProjectsParameters: ListProjectsParameters = (
  sourceWorkspaceID,
) =>
  eventParametersFor("list-projects", {
    SOURCE_WORKSPACE_ID: sourceWorkspaceID,
  });

type ListVersionsParameters = (
  sourceWorkspaceID: string,
  sourceProjectID: string,
) => EventParameters;
export const listVersionsParameters: ListVersionsParameters = (
  sourceWorkspaceID,
  sourceProjectID,
) =>
  eventParametersFor("list-versions", {
    SOURCE_WORKSPACE_ID: sourceWorkspaceID,
    SOURCE_PROJECT_ID: sourceProjectID,
  });

type ListFoldersParameters = (
  destinationWorkspaceID: string,
) => EventParameters;
export const listFoldersParameters: ListFoldersParameters = (
  destinationWorkspaceID,
) =>
  eventParametersFor("list-folders", {
    DESTINATION_WORKSPACE_ID: destinationWorkspaceID,
  });

type PlanParameters = (selection: MigrationSelection) => EventParameters;
export const planParameters: PlanParameters = (selection) =>
  eventParametersFor("plan-migration", {
    SOURCE_WORKSPACE_ID: selection.sourceWorkspaceID,
    SOURCE_PROJECT_ID: selection.sourceProjectID,
    SOURCE_VERSION_ID: selection.sourceVersionID,
    DESTINATION_WORKSPACE_ID: selection.destinationWorkspaceID,
    DESTINATION_FOLDER_ID: selection.destinationFolderID,
    TARGET_SCHEMA_VERSION: selection.targetSchemaVersion,
  });

type ExecuteParameters = (
  selection: MigrationSelection,
  planID: string,
) => EventParameters;
export const executeParameters: ExecuteParameters = (selection, planID) =>
  eventParametersFor("execute-migration", {
    PLAN_ID: planID,
    SOURCE_WORKSPACE_ID: selection.sourceWorkspaceID,
    SOURCE_PROJECT_ID: selection.sourceProjectID,
    SOURCE_VERSION_ID: selection.sourceVersionID,
    DESTINATION_WORKSPACE_ID: selection.destinationWorkspaceID,
    DESTINATION_FOLDER_ID: selection.destinationFolderID,
    TARGET_SCHEMA_VERSION: selection.targetSchemaVersion,
    CONFIRMED: true,
  });
