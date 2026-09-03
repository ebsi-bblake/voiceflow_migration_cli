#!/usr/bin/env bun
import {
  DEFAULT_XYOPS_BASE_URL,
  readMigrationFileConfig,
  readXYOpsConfig,
} from "../config";
import { createXYOpsClient } from "../client";
import { isCheckSessionResult, isVoiceflowEnvelope } from "../guards";
import { requireEnvelopeResult } from "../validation";
import { asCliError, cliErrorOutput, fail } from "../diagnostics";
import {
  eventParametersFor,
  initialMigrationState,
  stateSelection,
  type MigrationState,
} from "../state";
import { CreatePromptReader } from "../prompt";
import {
  selectSourceSelection,
  selectDestinationSelection,
  type MigrationContext,
} from "./selection";
import { readMigrationPlan } from "./planning";
import { confirmAndExecuteMigration, displayPlan } from "./execution";
import { readSecretsForMigration } from "./secret-input";

type PrintHelp = () => void;
const printHelp: PrintHelp = () => {
  [
    "Usage: bun run xyops/cli/index.ts",
    "Interactively plan and execute a Voiceflow migration through XYOps.",
    `Local configuration: XYOPS_API_KEY=<key> (required), XYOPS_BASE_URL=<url> (default: ${DEFAULT_XYOPS_BASE_URL}).`,
    "Optional --config=<JSON-file> supplies migration IDs, schema version, and project secrets.",
    'Config format: { "source_workspace_id": "...", "target_schema_version": "13.1", "secrets": [{ "name": "EXAMPLE_SECRET", "value": "REDACTED" }] }.',
    "Configured values bypass their prompts; missing values are selected interactively.",
    "Optional XYOPS_EVENT_* overrides accept title:<event-title> or id:<event-id>.",
    "Default event titles must match the configured XYOps Event titles.",
  ].forEach((msg) => console.log(msg));
};

const helpRequested = (): boolean =>
  process.argv.includes("--help") || process.argv.includes("-h");
const requireActiveSession = (active: boolean): void => {
  if (!active)
    throw fail("envelope", {
      nextAction: "The configured Voiceflow session is not active.",
    });
};

type PerformMigration = (context: MigrationContext) => Promise<void>;
const performMigration: PerformMigration = async (context) => {
  const { client, config } = context;
  const sessionResponse = await client.readEvent(
    config.events.checkSession,
    eventParametersFor("check_session"),
    isVoiceflowEnvelope(isCheckSessionResult),
  );
  requireActiveSession(
    requireEnvelopeResult(
      sessionResponse,
      "check_session",
      isCheckSessionResult,
    ).active,
  );
  const state: MigrationState = {
    ...initialMigrationState(),
    ...(await selectSourceSelection(context)),
    ...(await selectDestinationSelection(context)),
  };
  const selection = stateSelection(state);
  const secretFileContents = await readSecretsForMigration(
    context.reader,
    context.migrationConfig,
  );
  const plan = await readMigrationPlan(context, selection);
  displayPlan(plan);
  await confirmAndExecuteMigration(
    context,
    selection,
    plan.planID,
    secretFileContents,
  );
};

type Run = () => Promise<void>;
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
  const migrationConfig = await readMigrationFileConfig();
  const client = createXYOpsClient(config);
  const reader = CreatePromptReader();
  try {
    await performMigration({ reader, client, config, migrationConfig });
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
