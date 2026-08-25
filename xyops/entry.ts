import { createCheckSessionRunner } from "./voiceflow/vf_check_session";
import { createExecuteMigrationRunner } from "./voiceflow/vf_execute_migration";
import { createListFoldersRunner } from "./voiceflow/vf_list_folders";
import { createListProjectsRunner } from "./voiceflow/vf_list_projects";
import { createListVersionsRunner } from "./voiceflow/vf_list_versions";
import { createListWorkspacesRunner } from "./voiceflow/vf_list_workspaces";
import { createPlanMigrationRunner } from "./voiceflow/vf_plan_migration";
import type { Envelope } from "./voiceflow/vf_contracts";
import type { Runner } from "./voiceflow/runner_runtime";

export type RunnerName =
  | "check-session"
  | "list-workspaces"
  | "list-projects"
  | "list-versions"
  | "list-folders"
  | "plan-migration"
  | "execute-migration";

type RunnerFactory = () => Runner<Envelope<unknown>>;
type RunnerRegistry = Readonly<Record<RunnerName, RunnerFactory>>;
const runnerRegistry: RunnerRegistry = {
  "check-session": createCheckSessionRunner,
  "list-workspaces": createListWorkspacesRunner,
  "list-projects": createListProjectsRunner,
  "list-versions": createListVersionsRunner,
  "list-folders": createListFoldersRunner,
  "plan-migration": createPlanMigrationRunner,
  "execute-migration": createExecuteMigrationRunner,
};

type ReadRunnerName = () => string | undefined;
const readRunnerName: ReadRunnerName = () => process.env.RUNNER_NAME;

type IsRunnerName = (value: string) => value is RunnerName;
const isRunnerName: IsRunnerName = (value): value is RunnerName =>
  typeof value === "string" && Object.hasOwn(runnerRegistry, value);

type ReportInvalidRunnerName = () => void;
const reportInvalidRunnerName: ReportInvalidRunnerName = () => {
  process.stderr.write("RUNNER_NAME is not a supported runner\n");
  process.exitCode = 1;
};

type StartSelectedRunner = () => void;
const startSelectedRunner: StartSelectedRunner = () => {
  const runnerName = readRunnerName();
  if (!runnerName) return;
  if (!isRunnerName(runnerName)) {
    reportInvalidRunnerName();
    return;
  }

  runnerRegistry[runnerName]().start();
};

startSelectedRunner();
