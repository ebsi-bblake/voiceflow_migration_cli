import { createXYOpsClient } from "../client";
import { isOptionResult, isVoiceflowEnvelope } from "../guards";
import { requireEnvelopeResult } from "../validation";
import { fail } from "../diagnostics";
import type { EventParameters, MigrationSelection, XYOpsEventReference } from "../types";
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
) => configuredValue === undefined
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
    reader, client, config.events.listWorkspaces, listWorkspacesParameters(), "source_workspace_id (Source workspace)",
  );
  const sourceProjectID = await selectConfiguredOrCatalog(
    context.migrationConfig?.sourceProjectID,
    reader, client, config.events.listProjects, listProjectsParameters(sourceWorkspaceID), "source_project_id (Source project)",
  );
  const sourceVersionID = await selectConfiguredOrCatalog(
    context.migrationConfig?.sourceVersionID,
    reader, client, config.events.listVersions, listVersionsParameters(sourceWorkspaceID, sourceProjectID), "source_version_id (Source draft/published version)",
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
export const selectDestinationSelection: SelectDestinationSelection = async (context) => {
  const { reader, client, config } = context;
  const destinationWorkspaceID = await selectConfiguredOrCatalog(
    context.migrationConfig?.destinationWorkspaceID,
    reader, client, config.events.listWorkspaces, listWorkspacesParameters(), "destination_workspace_id (Destination workspace)",
  );
  const destinationFolderID = await selectConfiguredOrCatalog(
    context.migrationConfig?.destinationFolderID,
    reader, client, config.events.listFolders, listFoldersParameters(destinationWorkspaceID), "destination_folder_id (Destination folder)",
  );
  const configuredSchemaVersion = context.migrationConfig?.targetSchemaVersion;
  const targetSchemaVersion =
    configuredSchemaVersion ??
    ((await reader.ask("target_schema_version [13.1]: ")).trim() || "13.1");
  return { destinationWorkspaceID, destinationFolderID, targetSchemaVersion };
};
