#!/usr/bin/env bun
import {
  DEFAULT_XYOPS_BASE_URL,
  readXYOpsConfig,
  type XYOpsEventReference,
} from "./xyops/cli/config";
import { createXYOpsClient } from "./xyops/cli/client";
import {
  isCheckSessionResult,
  isExecuteResult,
  isMigrationPlan,
  isOptionResult,
  isVoiceflowEnvelope,
  requireEnvelopeResult,
  type ExecuteResult,
  type MigrationPlan,
  type VoiceflowWarning,
} from "./xyops/cli/contracts";
import { asCliError, cliErrorOutput, fail } from "./xyops/cli/diagnostics";
import {
  executeParameters,
  eventParametersFor,
  initialMigrationState,
  listFoldersParameters,
  listProjectsParameters,
  listVersionsParameters,
  listWorkspacesParameters,
  planParameters,
  requireStateValue,
  setStateValue,
  stateSelection,
  type MigrationState,
} from "./xyops/cli/state";
import type { EventParameters } from "./xyops/cli/contracts";
import { bounded, chooseOption, PromptReader } from "./xyops/cli/prompt";

type PrintHelp = () => void;
const printHelp: PrintHelp = () => {
  console.log("Usage: bun run migration-cli.ts");
  console.log("Interactively plan and execute a Voiceflow migration through XYOps.");
  console.log(`Local configuration: XYOPS_API_KEY=<key> (required), XYOPS_BASE_URL=<url> (default: ${DEFAULT_XYOPS_BASE_URL}).`);
  console.log("Optional XYOPS_EVENT_* overrides accept title:<event-title> or id:<event-id>.");
  console.log("Default event titles must match the configured XYOps Event titles.");
};

type ReadOptions = (value: unknown, title: string) => readonly { value: string; label: string }[];
const readOptions: ReadOptions = (value, title) => {
  try {
    return requireEnvelopeResult(value, title, isOptionResult).options;
  } catch {
    throw fail("envelope", { nextAction: `${title} returned no usable options.` });
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
  console.log(`Destination workspace: ${bounded(plan.labels.destinationWorkspace)}`);
  console.log(`Destination folder: ${bounded(plan.labels.destinationFolder)}`);
  console.log(`Target schema: ${bounded(plan.selection.targetSchemaVersion, 40)}`);
};

type IsWarning = (value: VoiceflowWarning, code: string) => boolean;
const isWarning: IsWarning = (value, code) => value.code === code;

type NumberField = (
  value: ExecuteResult,
  key: "exportStatus" | "exportBytes" | "importStatus" | "importBytes",
) => number;
const numberField: NumberField = (value, key) => value[key];

type SummarizeExecution = (value: unknown, planID: string) => Readonly<Record<string, unknown>>;
const summarizeExecution: SummarizeExecution = (value, planID) => {
  if (!isExecuteResult(value)) throw fail("envelope", { nextAction: "The execute event returned an invalid result." });
  const summary: Record<string, unknown> = { migrationCompleted: true, planID };
  for (const key of ["exportStatus", "exportBytes", "importStatus", "importBytes"] as const) {
    const field = numberField(value, key);
    summary[key] = field;
  }
  for (const key of ["apiKeyRetrieved"] as const) {
    if (typeof value[key] === "boolean") summary[key] = value[key];
  }
  return summary;
};

type Run = () => Promise<void>;
export const run: Run = async () => {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  console.warn("WARNING: this performs a REAL Voiceflow export and import through XYOps.");
  console.warn("Use only the intended source version and destination workspace.");

  const config = readXYOpsConfig();
  const client = createXYOpsClient(config);
  const reader = new PromptReader();
  let state: MigrationState = initialMigrationState();

  try {
    const sessionResponse = await client.readEvent(
      config.events.checkSession,
      eventParametersFor("check-session"),
      isVoiceflowEnvelope(isCheckSessionResult),
    );
    const session = requireEnvelopeResult(sessionResponse, "check-session", isCheckSessionResult);
    if (!session.active) throw fail("envelope", { nextAction: "The configured Voiceflow session is not active." });

    const sourceWorkspaceID = await selectCatalog(
      reader,
      client,
      config.events.listWorkspaces,
      listWorkspacesParameters(),
      "Source workspace",
    );
    state = setStateValue(state, "sourceWorkspaceID", sourceWorkspaceID);
    const sourceProjectID = await selectCatalog(
      reader,
      client,
      config.events.listProjects,
      listProjectsParameters(sourceWorkspaceID),
      "Source project",
    );
    state = setStateValue(state, "sourceProjectID", sourceProjectID);
    const sourceVersionID = await selectCatalog(
      reader,
      client,
      config.events.listVersions,
      listVersionsParameters(sourceWorkspaceID, sourceProjectID),
      "Source draft/published version",
    );
    state = setStateValue(state, "sourceVersionID", sourceVersionID);
    const destinationWorkspaceID = await selectCatalog(
      reader,
      client,
      config.events.listWorkspaces,
      listWorkspacesParameters(),
      "Destination workspace",
    );
    state = setStateValue(state, "destinationWorkspaceID", destinationWorkspaceID);
    const destinationFolderID = await selectCatalog(
      reader,
      client,
      config.events.listFolders,
      listFoldersParameters(destinationWorkspaceID),
      "Destination folder",
    );
    state = setStateValue(state, "destinationFolderID", destinationFolderID);
    const targetSchemaVersion = (await reader.ask("Target schema version [13.1]: ")).trim() || "13.1";
    state = setStateValue(state, "targetSchemaVersion", targetSchemaVersion);

    const selection = stateSelection(state);
    const planResponse = await client.readEvent(
      config.events.planMigration,
      planParameters(selection),
      isVoiceflowEnvelope(isMigrationPlan),
    );
    const plan = requireEnvelopeResult(planResponse, "plan-migration", isMigrationPlan);
    state = setStateValue(state, "planID", plan.planID);
    displayPlan(plan);

    const confirmation = (await reader.ask("Perform this real migration? (yes/no): ")).trim().toLowerCase();
    if (confirmation !== "yes" && confirmation !== "y") {
      console.log("Aborted; no migration performed.");
      return;
    }

    const planID = requireStateValue(state, "planID");
    const executeResponse = await client.executeEvent(
      config.events.executeMigration,
      executeParameters(selection, planID),
      isVoiceflowEnvelope(isExecuteResult),
    );
    const execute = requireEnvelopeResult(executeResponse, "execute-migration", isExecuteResult);
    console.log(JSON.stringify(summarizeExecution(execute, planID)));
    if (executeResponse.ok && executeResponse.warnings.some((warning) => isWarning(warning, "API_KEY_RETRIEVAL_FAILED"))) {
      console.error("WARNING: migration completed, but API-key retrieval failed.");
      process.exitCode = 2;
    }
  } finally {
    reader.close();
  }
};

type HandleFailure = (error: unknown) => void;
const handleFailure: HandleFailure = (error) => {
  process.exitCode = 1;
  console.error(JSON.stringify({ migrationFailed: cliErrorOutput(asCliError(error)) }));
};

if (import.meta.main) {
  run().then(() => undefined).catch(handleFailure);
}
