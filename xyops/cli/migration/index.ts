#!/usr/bin/env bun
import {
  DEFAULT_XYOPS_BASE_URL,
  readXYOpsConfig,
  type XYOpsEventReference,
} from "../config";
import { createXYOpsClient } from "../client";
import {
  isCheckSessionResult,
  isExecuteResult,
  isMigrationPlan,
  isOptionResult,
  isVoiceflowEnvelope,
} from "../guards";
import { requireEnvelopeResult } from "../validation";
import type {
  ExecuteResult,
  EventParameters,
  MigrationPlan,
  MigrationSelection,
  VoiceflowWarning,
} from "../types";
import { asCliError, cliErrorOutput, fail } from "../diagnostics";
import {
  executeParameters,
  eventParametersFor,
  initialMigrationState,
  listFoldersParameters,
  listProjectsParameters,
  listVersionsParameters,
  listWorkspacesParameters,
  planParameters,
  stateSelection,
  type MigrationState,
} from "../state";
import { bounded, chooseOption, PromptReader } from "../prompt";

type PrintHelp = () => void;
const printHelp: PrintHelp = () => {
  console.log("Usage: bun run xyops/cli/index.ts");
  console.log(
    "Interactively plan and execute a Voiceflow migration through XYOps.",
  );
  console.log(
    `Local configuration: XYOPS_API_KEY=<key> (required), XYOPS_BASE_URL=<url> (default: ${DEFAULT_XYOPS_BASE_URL}).`,
  );
  console.log(
    "Optional XYOPS_EVENT_* overrides accept title:<event-title> or id:<event-id>.",
  );
  console.log(
    "Default event titles must match the configured XYOps Event titles.",
  );
};

type ReadOptions = (
  value: unknown,
  title: string,
) => readonly { value: string; label: string }[];
const readOptions: ReadOptions = (value, title) => {
  try {
    return requireEnvelopeResult(value, title, isOptionResult).options;
  } catch {
    throw fail("envelope", {
      nextAction: `${title} returned no usable options.`,
    });
  }
};

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

type DisplayPlan = (plan: MigrationPlan) => void;
const displayPlan: DisplayPlan = (plan) => {
  console.log("\nMigration plan:");
  console.log(`Plan ID: ${bounded(plan.planID, 100)}`);
  console.log(`Source workspace: ${bounded(plan.labels.sourceWorkspace)}`);
  console.log(`Source project: ${bounded(plan.labels.sourceProject)}`);
  console.log(`Source version: ${bounded(plan.labels.sourceVersion)}`);
  console.log(
    `Destination workspace: ${bounded(plan.labels.destinationWorkspace)}`,
  );
  console.log(`Destination folder: ${bounded(plan.labels.destinationFolder)}`);
  console.log(
    `Target schema: ${bounded(plan.selection.targetSchemaVersion, 40)}`,
  );
};

type IsWarning = (value: VoiceflowWarning, code: string) => boolean;
const isWarning: IsWarning = (value, code) => value.code === code;

type NumberField = (
  value: ExecuteResult,
  key: "exportStatus" | "exportBytes" | "importStatus" | "importBytes",
) => number;
const numberField: NumberField = (value, key) => value[key];
const executionFieldKeys = [
  "exportStatus",
  "exportBytes",
  "importStatus",
  "importBytes",
] as const;
const apiKeySummary = (
  value: ExecuteResult,
): Readonly<Record<string, unknown>> =>
  typeof value.apiKeyRetrieved === "boolean"
    ? { apiKeyRetrieved: value.apiKeyRetrieved }
    : {};

type SummarizeExecution = (
  value: unknown,
  planID: string,
) => Readonly<Record<string, unknown>>;
const summarizeExecution: SummarizeExecution = (value, planID) => {
  if (!isExecuteResult(value))
    throw fail("envelope", {
      nextAction: "The execute event returned an invalid result.",
    });
  const fields = Object.fromEntries(
    executionFieldKeys.map((key) => [key, numberField(value, key)]),
  );
  return {
    migrationCompleted: true,
    planID,
    ...fields,
    ...apiKeySummary(value),
  };
};

type Run = () => Promise<void>;
const helpRequested = (): boolean =>
  process.argv.includes("--help") || process.argv.includes("-h");
const requireActiveSession = (active: boolean): void => {
  if (!active)
    throw fail("envelope", {
      nextAction: "The configured Voiceflow session is not active.",
    });
};
const requireConfirmation = (confirmation: string): boolean =>
  ["y", "yes"].includes(confirmation);
const hasAPIKeyRetrievalWarning = (
  response: Awaited<
    ReturnType<ReturnType<typeof createXYOpsClient>["executeEvent"]>
  >,
): boolean =>
  response.ok &&
  response.warnings.some((warning) =>
    isWarning(warning, "API_KEY_RETRIEVAL_FAILED"),
  );
const warnAPIKeyRetrieval = (
  response: Awaited<
    ReturnType<ReturnType<typeof createXYOpsClient>["executeEvent"]>
  >,
): void => {
  if (hasAPIKeyRetrievalWarning(response)) {
    console.error(
      "WARNING: migration completed, but API-key retrieval failed.",
    );
    process.exitCode = 2;
  }
};
const defaultSchemaVersion = (value: string): string => value || "13.1";
type MigrationContext = Readonly<{
  reader: PromptReader;
  client: ReturnType<typeof createXYOpsClient>;
  config: ReturnType<typeof readXYOpsConfig>;
}>;
type SourceSelection = Pick<
  MigrationSelection,
  "sourceWorkspaceID" | "sourceProjectID" | "sourceVersionID"
>;
type DestinationSelection = Pick<
  MigrationSelection,
  "destinationWorkspaceID" | "destinationFolderID" | "targetSchemaVersion"
>;
type SelectSourceSelection = (context: MigrationContext) => Promise<SourceSelection>;
const selectSourceSelection: SelectSourceSelection = async ({ reader, client, config }) => {
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
type SelectDestinationSelection = (context: MigrationContext) => Promise<DestinationSelection>;
const selectDestinationSelection: SelectDestinationSelection = async ({ reader, client, config }) => {
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
  const targetSchemaVersion = defaultSchemaVersion(
    (await reader.ask("Target schema version [13.1]: ")).trim(),
  );
  return { destinationWorkspaceID, destinationFolderID, targetSchemaVersion };
};
type ReadMigrationPlan = (context: MigrationContext, selection: MigrationSelection) => Promise<MigrationPlan>;
const readMigrationPlan: ReadMigrationPlan = ({ client, config }, selection) =>
  client
    .readEvent(
      config.events.planMigration,
      planParameters(selection),
      isVoiceflowEnvelope(isMigrationPlan),
    )
    .then((response) =>
      requireEnvelopeResult(response, "plan-migration", isMigrationPlan),
    );
type ConfirmAndExecuteMigration = (
  context: MigrationContext,
  selection: MigrationSelection,
  planID: string,
) => Promise<void>;
const confirmAndExecuteMigration: ConfirmAndExecuteMigration = async (
  { reader, client, config },
  selection,
  planID,
) => {
  const confirmation = (await reader.ask("Perform this real migration? (yes/no): "))
    .trim()
    .toLowerCase();
  if (!requireConfirmation(confirmation)) {
    console.log("Aborted; no migration performed.");
    return;
  }
  const executeResponse = await client.executeEvent(
    config.events.executeMigration,
    executeParameters(selection, planID),
    isVoiceflowEnvelope(isExecuteResult),
  );
  const execute = requireEnvelopeResult(
    executeResponse,
    "execute-migration",
    isExecuteResult,
  );
  console.log(JSON.stringify(summarizeExecution(execute, planID)));
  warnAPIKeyRetrieval(executeResponse);
};
type PerformMigration = (context: MigrationContext) => Promise<void>;
const performMigration: PerformMigration = async (context) => {
  const { client, config } = context;
  const sessionResponse = await client.readEvent(
    config.events.checkSession,
    eventParametersFor("check-session"),
    isVoiceflowEnvelope(isCheckSessionResult),
  );
  requireActiveSession(
    requireEnvelopeResult(
      sessionResponse,
      "check-session",
      isCheckSessionResult,
    ).active,
  );
  const state: MigrationState = {
    ...initialMigrationState(),
    ...(await selectSourceSelection(context)),
    ...(await selectDestinationSelection(context)),
  };
  const selection = stateSelection(state);
  const plan = await readMigrationPlan(context, selection);
  displayPlan(plan);
  await confirmAndExecuteMigration(context, selection, plan.planID);
};
export const run: Run = async () => {
  if (helpRequested()) {
    printHelp();
    return;
  }
  console.warn(
    "WARNING: this performs a REAL Voiceflow export and import through XYOps.",
  );
  console.warn(
    "Use only the intended source version and destination workspace.",
  );

  const config = readXYOpsConfig();
  const client = createXYOpsClient(config);
  const reader = new PromptReader();
  try {
    await performMigration({ reader, client, config });
  } finally {
    reader.close();
  }
};

type HandleFailure = (error: unknown) => void;
const handleFailure: HandleFailure = (error) => {
  process.exitCode = 1;
  console.error(
    JSON.stringify({ migrationFailed: cliErrorOutput(asCliError(error)) }),
  );
};

if (import.meta.main) {
  run()
    .then(() => undefined)
    .catch(handleFailure);
}
