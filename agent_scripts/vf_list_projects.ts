import { resolveVoiceflowAuth } from "./vf_auth";
import { listProjects } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";
import {
  createRunner,
  requireEnvironmentValue,
  type Runner,
} from "./runner_runtime";

type ListProjectsResult = {
  options: Awaited<ReturnType<typeof listProjects>>;
};

type ListProjectsForWorkspace = (
  workspaceID: string,
) => (auth: Parameters<typeof listProjects>[0]) =>
  ReturnType<typeof listProjects>;
const listProjectsForWorkspace: ListProjectsForWorkspace = (workspaceID) =>
  (auth) => listProjects(auth, workspaceID);

type Main = (
  token: string,
  workspaceID: string,
) => Promise<Envelope<ListProjectsResult>>;
export const main: Main = (token, workspaceID) => {
  const id = crypto.randomUUID();
  return resolveVoiceflowAuth(token)
    .then(listProjectsForWorkspace(workspaceID))
    .then((options) => success("list-projects", id, { options }))
    .catch((error) => failure("list-projects", id, error));
};

type ListProjectsEnvelope = Awaited<ReturnType<typeof main>>;
type ListProjectsRunner = Runner<ListProjectsEnvelope>;

type ListProjectsRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly WORKSPACE_ID: string | undefined;
};

type ReadListProjectsRequest = () => ListProjectsRequest;
const readListProjectsRequest: ReadListProjectsRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  WORKSPACE_ID: process.env.WORKSPACE_ID,
});

type CreateListProjectsRunner = () => ListProjectsRunner;
export const createListProjectsRunner: CreateListProjectsRunner = () =>
  createRunner("list-projects", () => {
    const request = readListProjectsRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
      requireEnvironmentValue("WORKSPACE_ID", request.WORKSPACE_ID),
    );
  });
