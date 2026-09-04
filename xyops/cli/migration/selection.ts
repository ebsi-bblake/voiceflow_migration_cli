import { createXYOpsClient } from "../client";
import { isOptionResult, isVoiceflowEnvelope } from "../guards";
import { requireEnvelopeResult } from "../validation";
import { fail } from "../diagnostics";
import type {
  EventParameters,
  MigrationSelection,
  XYOpsEventReference,
} from "../types";
import { chooseOption, PromptReader } from "../prompt";
import {
  listFoldersParameters,
  listProjectsParameters,
  listVersionsParameters,
  listWorkspacesParameters,
} from "../state";
import type { MigrationFileConfig, readXYOpsConfig } from "../config";

type MigrationContext = Readonly<{
  reader: PromptReader;
  client: ReturnType<typeof createXYOpsClient>;
  config: ReturnType<typeof readXYOpsConfig>;
  migrationConfig?: MigrationFileConfig;
}>;
export type { MigrationContext };

type ValidateConfiguredOption = (
  context: MigrationContext,
  configuredValue: string | undefined,
  eventReference: XYOpsEventReference,
  parameters: EventParameters,
  field: string,
) => Promise<void>;
const validateConfiguredOption: ValidateConfiguredOption = async (
  context,
  configuredValue,
  eventReference,
  parameters,
  field,
) => {
  if (configuredValue === undefined) return;
  const response = await context.client.readEvent(
    eventReference,
    parameters,
    isVoiceflowEnvelope(isOptionResult),
  );
  const options = readOptions(response, field);
  if (!options.some((option) => option.value === configuredValue))
    throw fail("configuration", {
      nextAction: `${field} does not identify a value available in XYOps.`,
    });
};

type ValidateConfiguredMigrationValues = (
  context: MigrationContext,
  selection: MigrationSelection,
) => Promise<void>;
const validateConfiguredSourceDetails: ValidateConfiguredMigrationValues =
  async (context, selection) => {
    const migrationConfig = context.migrationConfig;
    if (migrationConfig === undefined) return;
    const sourceWorkspaceID = selection.sourceWorkspaceID;
    const sourceProjectID = selection.sourceProjectID;
    const { config } = context;
    if (sourceWorkspaceID !== undefined)
      await validateConfiguredOption(
        context,
        migrationConfig.sourceProjectID,
        config.events.listProjects,
        listProjectsParameters(sourceWorkspaceID),
        "source_project_id",
      );
    if (sourceWorkspaceID !== undefined && sourceProjectID !== undefined)
      await validateConfiguredOption(
        context,
        migrationConfig.sourceVersionID,
        config.events.listVersions,
        listVersionsParameters(sourceWorkspaceID, sourceProjectID),
        "source_version_id",
      );
  };
const validateConfiguredSourceValues: ValidateConfiguredMigrationValues =
  async (context, selection) => {
    const migrationConfig = context.migrationConfig;
    if (migrationConfig === undefined) return;
    const { config } = context;
    await validateConfiguredOption(
      context,
      migrationConfig.sourceWorkspaceID,
      config.events.listWorkspaces,
      listWorkspacesParameters(),
      "source_workspace_id",
    );
    await validateConfiguredSourceDetails(context, selection);
  };
const validateConfiguredDestinationValues: ValidateConfiguredMigrationValues =
  async (context, selection) => {
    const migrationConfig = context.migrationConfig;
    if (migrationConfig === undefined) return;
    const { config } = context;
    const destinationWorkspaceID = selection.destinationWorkspaceID;
    await validateConfiguredOption(
      context,
      migrationConfig.destinationWorkspaceID,
      config.events.listWorkspaces,
      listWorkspacesParameters(),
      "destination_workspace_id",
    );
    if (destinationWorkspaceID !== undefined)
      await validateConfiguredOption(
        context,
        migrationConfig.destinationFolderID,
        config.events.listFolders,
        listFoldersParameters(destinationWorkspaceID),
        "destination_folder_id",
      );
  };
export const validateConfiguredMigrationValues: ValidateConfiguredMigrationValues =
  (context, selection) =>
    validateConfiguredSourceValues(context, selection).then(() =>
      validateConfiguredDestinationValues(context, selection),
    );

type SelectConfiguredOrCatalog = (
  configuredValue: string | undefined,
  reader: PromptReader,
  client: ReturnType<typeof createXYOpsClient>,
  eventReference: XYOpsEventReference,
  parameters: EventParameters,
  title: string,
) => Promise<string>;
const selectConfiguredOrCatalog: SelectConfiguredOrCatalog = (
  configuredValue,
  reader,
  client,
  eventReference,
  parameters,
  title,
) =>
  configuredValue === undefined
    ? selectCatalog(reader, client, eventReference, parameters, title)
    : Promise.resolve(configuredValue);

type SelectCatalog = (
  reader: PromptReader,
  client: ReturnType<typeof createXYOpsClient>,
  eventReference: XYOpsEventReference,
  parameters: EventParameters,
  title: string,
) => Promise<string>;
const selectCatalog: SelectCatalog = async (
  reader,
  client,
  eventReference,
  parameters,
  title,
) => {
  const response = await client.readEvent(
    eventReference,
    parameters,
    isVoiceflowEnvelope(isOptionResult),
  );
  return chooseOption(reader, title, readOptions(response, title));
};

const readOptions = (
  value: unknown,
  title: string,
): readonly { value: string; label: string }[] => {
  try {
    return requireEnvelopeResult(value, title, isOptionResult).options;
  } catch {
    throw fail("envelope", {
      nextAction: `${title} returned no usable options.`,
    });
  }
};

type SourceSelection = Pick<
  MigrationSelection,
  "sourceWorkspaceID" | "sourceProjectID" | "sourceVersionID"
>;
export type SelectSourceSelection = (
  context: MigrationContext,
) => Promise<SourceSelection>;
export const selectSourceSelection: SelectSourceSelection = async (context) => {
  const { reader, client, config } = context;
  const sourceWorkspaceID = await selectConfiguredOrCatalog(
    context.migrationConfig?.sourceWorkspaceID,
    reader,
    client,
    config.events.listWorkspaces,
    listWorkspacesParameters(),
    "source_workspace_id (Source workspace)",
  );
  const sourceProjectID = await selectConfiguredOrCatalog(
    context.migrationConfig?.sourceProjectID,
    reader,
    client,
    config.events.listProjects,
    listProjectsParameters(sourceWorkspaceID),
    "source_project_id (Source project)",
  );
  const sourceVersionID = await selectConfiguredOrCatalog(
    context.migrationConfig?.sourceVersionID,
    reader,
    client,
    config.events.listVersions,
    listVersionsParameters(sourceWorkspaceID, sourceProjectID),
    "source_version_id (Source draft/published version)",
  );
  return { sourceWorkspaceID, sourceProjectID, sourceVersionID };
};

type DestinationSelection = Pick<
  MigrationSelection,
  "destinationWorkspaceID" | "destinationFolderID" | "targetSchemaVersion"
>;
export type SelectDestinationSelection = (
  context: MigrationContext,
) => Promise<DestinationSelection>;
export const selectDestinationSelection: SelectDestinationSelection = async (
  context,
) => {
  const { reader, client, config } = context;
  const destinationWorkspaceID = await selectConfiguredOrCatalog(
    context.migrationConfig?.destinationWorkspaceID,
    reader,
    client,
    config.events.listWorkspaces,
    listWorkspacesParameters(),
    "destination_workspace_id (Destination workspace)",
  );
  const destinationFolderID = await selectConfiguredOrCatalog(
    context.migrationConfig?.destinationFolderID,
    reader,
    client,
    config.events.listFolders,
    listFoldersParameters(destinationWorkspaceID),
    "destination_folder_id (Destination folder)",
  );
  return {
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion: context.migrationConfig?.targetSchemaVersion,
  };
};
