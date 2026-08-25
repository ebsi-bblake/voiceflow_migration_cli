import { resolveVoiceflowAuth } from "./vf_auth";
import { listFolders } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";
import {
  createRunner,
  requireEnvironmentValue,
  type Runner,
} from "./runner_runtime";

type ListFoldersResult = {
  options: Awaited<ReturnType<typeof listFolders>>;
};

type ListFoldersForWorkspace = (
  workspaceID: string,
) => (auth: Parameters<typeof listFolders>[0]) =>
  ReturnType<typeof listFolders>;
const listFoldersForWorkspace: ListFoldersForWorkspace = (workspaceID) =>
  (auth) => listFolders(auth, workspaceID);

type Main = (
  token: string,
  workspaceID: string,
) => Promise<Envelope<ListFoldersResult>>;
export const main: Main = (token, workspaceID) => {
  const id = crypto.randomUUID();
  return resolveVoiceflowAuth(token)
    .then(listFoldersForWorkspace(workspaceID))
    .then((options) => success("list-folders", id, { options }))
    .catch((error) => failure("list-folders", id, error));
};

type ListFoldersEnvelope = Awaited<ReturnType<typeof main>>;
type ListFoldersRunner = Runner<ListFoldersEnvelope>;

type ListFoldersRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly WORKSPACE_ID: string | undefined;
};

type ReadListFoldersRequest = () => ListFoldersRequest;
const readListFoldersRequest: ReadListFoldersRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  WORKSPACE_ID: process.env.WORKSPACE_ID,
});

type CreateListFoldersRunner = () => ListFoldersRunner;
export const createListFoldersRunner: CreateListFoldersRunner = () =>
  createRunner("list-folders", () => {
    const request = readListFoldersRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
      requireEnvironmentValue("WORKSPACE_ID", request.WORKSPACE_ID),
    );
  });
