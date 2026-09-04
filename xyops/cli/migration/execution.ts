import { isExecuteResult, isVoiceflowEnvelope } from "../guards";
import { requireEnvelopeResult } from "../validation";
import { bounded } from "../prompt";
import type {
  ExecuteResult,
  MigrationPlan,
  MigrationSelection,
  SecretEntries,
  VoiceflowEnvelope,
  VoiceflowWarning,
} from "../types";
import { executeParameters } from "../state";
import { fail } from "../diagnostics";
import type { MigrationContext } from "./selection";

type DisplayPlan = (plan: MigrationPlan) => void;
export const displayPlan: DisplayPlan = (plan) => {
  [
    "\nMigration plan:",
    `Plan ID: ${bounded(plan.planID, 100)}`,
    `Source workspace: ${bounded(plan.labels.sourceWorkspace)}`,
    `Source project: ${bounded(plan.labels.sourceProject)}`,
    `Source version: ${bounded(plan.labels.sourceVersion)}`,
    `Destination workspace: ${bounded(plan.labels.destinationWorkspace)}`,
    `Destination folder: ${bounded(plan.labels.destinationFolder)}`,
    `Target schema: ${bounded(plan.selection.targetSchemaVersion, 40)}`,
  ].forEach((msg) => console.log(msg));
};

type IsWarning = (value: VoiceflowWarning, code: string) => boolean;
const isWarning: IsWarning = (value, code) => value.code === code;
const hasAPIKeyRetrievalWarning = (
  response: VoiceflowEnvelope<ExecuteResult>,
): boolean =>
  response.ok &&
  response.warnings.some((warning) =>
    isWarning(warning, "API_KEY_RETRIEVAL_FAILED"),
  );
const warnAPIKeyRetrieval = (
  response: VoiceflowEnvelope<ExecuteResult>,
): void => {
  if (hasAPIKeyRetrievalWarning(response)) {
    console.error("WARNING: migration completed, but API-key retrieval failed.");
    process.exitCode = 2;
  }
};

type RequestMigrationConfirmation = (reader: MigrationContext["reader"]) => Promise<boolean>;
export const requestMigrationConfirmation: RequestMigrationConfirmation = (reader) =>
  reader.ask("Perform this real migration? (yes/no): ").then((answer) => {
    const confirmation = answer.trim().toLowerCase();
    if (["y", "yes"].includes(confirmation)) return true;
    console.log("Aborted; no migration performed.");
    return false;
  });

type ExecuteConfirmedMigration = (
  context: MigrationContext,
  selection: MigrationSelection,
  planID: string,
  secretFileContents?: SecretEntries,
) => Promise<void>;
export const executeConfirmedMigration: ExecuteConfirmedMigration = async (
  { client, config },
  selection,
  planID,
  secretFileContents,
) => {
  const executeResponse = await client.executeEvent(
    config.events.executeMigration,
    executeParameters(selection, planID, secretFileContents),
    isVoiceflowEnvelope(isExecuteResult),
  );
  const execute = requireEnvelopeResult(
    executeResponse,
    "execute_migration",
    isExecuteResult,
  );
  console.log(JSON.stringify(summarizeExecution(execute, planID)));
  warnAPIKeyRetrieval(executeResponse);
};

type ConfirmAndExecuteMigration = (
  context: MigrationContext,
  selection: MigrationSelection,
  planID: string,
  secretFileContents?: SecretEntries,
) => Promise<void>;
export const confirmAndExecuteMigration: ConfirmAndExecuteMigration = async (
  context,
  selection,
  planID,
  secretFileContents,
) => {
  if (await requestMigrationConfirmation(context.reader))
    await executeConfirmedMigration(context, selection, planID, secretFileContents);
};

const executionFieldKeys = [
  "exportStatus",
  "exportBytes",
  "importStatus",
  "importBytes",
] as const;
const summarizeExecution = (
  value: unknown,
  planID: string,
): Readonly<Record<string, unknown>> => {
  if (!isExecuteResult(value))
    throw fail("envelope", {
      nextAction: "The execute event returned an invalid result.",
    });
  return {
    migrationCompleted: true,
    planID,
    ...Object.fromEntries(executionFieldKeys.map((key) => [key, value[key]])),
    apiKeyRetrieved: value.apiKeyRetrieved,
  };
};
