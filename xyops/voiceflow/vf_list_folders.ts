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
  destinationWorkspaceID: string,
) => (auth: Parameters<typeof listFolders>[0]) =>
  ReturnType<typeof listFolders>;
const listFoldersForWorkspace: ListFoldersForWorkspace = (destinationWorkspaceID) =>
  (auth) => listFolders(auth, destinationWorkspaceID);

type Main = (
  token: string,
  destinationWorkspaceID: string,
) => Promise<Envelope<ListFoldersResult>>;
export const main: Main = (token, destinationWorkspaceID) => {
  const id = crypto.randomUUID();
  return resolveVoiceflowAuth(token)
    .then(listFoldersForWorkspace(destinationWorkspaceID))
    .then((options) => success("list-folders", id, { options }))
    .catch((error) => failure("list-folders", id, error));
};

type ListFoldersEnvelope = Awaited<ReturnType<typeof main>>;
type ListFoldersRunner = Runner<ListFoldersEnvelope>;

type ListFoldersRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly DESTINATION_WORKSPACE_ID: string | undefined;
};

type ReadListFoldersRequest = () => ListFoldersRequest;
const readListFoldersRequest: ReadListFoldersRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  DESTINATION_WORKSPACE_ID: process.env.DESTINATION_WORKSPACE_ID,
});

type CreateListFoldersRunner = () => ListFoldersRunner;
export const createListFoldersRunner: CreateListFoldersRunner = () =>
  createRunner("list-folders", () => {
    const request = readListFoldersRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
      requireEnvironmentValue(
        "DESTINATION_WORKSPACE_ID",
        request.DESTINATION_WORKSPACE_ID,
      ),
    );
  });
