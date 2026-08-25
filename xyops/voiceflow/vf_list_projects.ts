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
  sourceWorkspaceID: string,
) => (auth: Parameters<typeof listProjects>[0]) =>
  ReturnType<typeof listProjects>;
const listProjectsForWorkspace: ListProjectsForWorkspace = (sourceWorkspaceID) =>
  (auth) => listProjects(auth, sourceWorkspaceID);

type Main = (
  token: string,
  sourceWorkspaceID: string,
) => Promise<Envelope<ListProjectsResult>>;
export const main: Main = (token, sourceWorkspaceID) => {
  const id = crypto.randomUUID();
  return resolveVoiceflowAuth(token)
    .then(listProjectsForWorkspace(sourceWorkspaceID))
    .then((options) => success("list-projects", id, { options }))
    .catch((error) => failure("list-projects", id, error));
};

type ListProjectsEnvelope = Awaited<ReturnType<typeof main>>;
type ListProjectsRunner = Runner<ListProjectsEnvelope>;

type ListProjectsRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly SOURCE_WORKSPACE_ID: string | undefined;
};

type ReadListProjectsRequest = () => ListProjectsRequest;
const readListProjectsRequest: ReadListProjectsRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  SOURCE_WORKSPACE_ID: process.env.SOURCE_WORKSPACE_ID,
});

type CreateListProjectsRunner = () => ListProjectsRunner;
export const createListProjectsRunner: CreateListProjectsRunner = () =>
  createRunner("list-projects", () => {
    const request = readListProjectsRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
      requireEnvironmentValue(
        "SOURCE_WORKSPACE_ID",
        request.SOURCE_WORKSPACE_ID,
      ),
    );
  });
