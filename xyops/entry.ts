import { createCheckSessionRunner } from "../agent_scripts/vf_check_session";
import { createExecuteMigrationRunner } from "../agent_scripts/vf_execute_migration";
import { createListFoldersRunner } from "../agent_scripts/vf_list_folders";
import { createListProjectsRunner } from "../agent_scripts/vf_list_projects";
import { createListVersionsRunner } from "../agent_scripts/vf_list_versions";
import { createListWorkspacesRunner } from "../agent_scripts/vf_list_workspaces";
import { createPlanMigrationRunner } from "../agent_scripts/vf_plan_migration";
import type { Envelope } from "../agent_scripts/vf_contracts";
import type { Runner } from "../agent_scripts/runner_runtime";

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
