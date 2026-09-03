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
import type { readXYOpsConfig } from "../config";

type MigrationContext = Readonly<{
  reader: PromptReader;
  client: ReturnType<typeof createXYOpsClient>;
  config: ReturnType<typeof readXYOpsConfig>;
}>;
export type { MigrationContext };

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
export const selectSourceSelection: SelectSourceSelection = async ({
  reader,
  client,
  config,
}) => {
  const sourceWorkspaceID = await selectCatalog(
    reader,
    client,
    config.events.listWorkspaces,
    listWorkspacesParameters(),
    "Source workspace",
  );
  const sourceProjectID = await selectCatalog(
    reader,
    client,
    config.events.listProjects,
    listProjectsParameters(sourceWorkspaceID),
    "Source project",
  );
  const sourceVersionID = await selectCatalog(
    reader,
    client,
    config.events.listVersions,
    listVersionsParameters(sourceWorkspaceID, sourceProjectID),
    "Source draft/published version",
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
export const selectDestinationSelection: SelectDestinationSelection = async ({
  reader,
  client,
  config,
}) => {
  const destinationWorkspaceID = await selectCatalog(
    reader,
    client,
    config.events.listWorkspaces,
    listWorkspacesParameters(),
    "Destination workspace",
  );
  const destinationFolderID = await selectCatalog(
    reader,
    client,
    config.events.listFolders,
    listFoldersParameters(destinationWorkspaceID),
    "Destination folder",
  );
  const targetSchemaVersion =
    (await reader.ask("Target schema version [13.1]: ")).trim() || "13.1";
  return { destinationWorkspaceID, destinationFolderID, targetSchemaVersion };
};
