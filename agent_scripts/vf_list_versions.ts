import { resolveVoiceflowAuth } from "./vf_auth";
import { listVersions } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";
import {
  createRunner,
  requireEnvironmentValue,
  type Runner,
} from "./runner_runtime";

type ListVersionsResult = {
  options: Awaited<ReturnType<typeof listVersions>>;
};

type ListVersionsForSelection = (
  workspaceID: string,
  projectID: string,
) => (auth: Parameters<typeof listVersions>[0]) =>
  ReturnType<typeof listVersions>;
const listVersionsForSelection: ListVersionsForSelection = (
  workspaceID,
  projectID,
) => (auth) => listVersions(auth, workspaceID, projectID);

type Main = (
  token: string,
  workspaceID: string,
  projectID: string,
) => Promise<Envelope<ListVersionsResult>>;
export const main: Main = (token, workspaceID, projectID) => {
  const id = crypto.randomUUID();
  return resolveVoiceflowAuth(token)
    .then(listVersionsForSelection(workspaceID, projectID))
    .then((options) => success("list-versions", id, { options }))
    .catch((error) => failure("list-versions", id, error));
};

type ListVersionsEnvelope = Awaited<ReturnType<typeof main>>;
type ListVersionsRunner = Runner<ListVersionsEnvelope>;

type ListVersionsRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly WORKSPACE_ID: string | undefined;
  readonly PROJECT_ID: string | undefined;
};

type ReadListVersionsRequest = () => ListVersionsRequest;
const readListVersionsRequest: ReadListVersionsRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  WORKSPACE_ID: process.env.WORKSPACE_ID,
  PROJECT_ID: process.env.PROJECT_ID,
});

type CreateListVersionsRunner = () => ListVersionsRunner;
export const createListVersionsRunner: CreateListVersionsRunner = () =>
  createRunner("list-versions", () => {
    const request = readListVersionsRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
      requireEnvironmentValue("WORKSPACE_ID", request.WORKSPACE_ID),
      requireEnvironmentValue("PROJECT_ID", request.PROJECT_ID),
    );
  });
