import { listWorkspaces } from "./vf_catalog";
import { resolveVoiceflowAuth } from "./vf_auth";
import { success, failure } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";
import {
  createRunner,
  requireEnvironmentValue,
  type Runner,
} from "./runner_runtime";

type ListWorkspacesResult = {
  options: Awaited<ReturnType<typeof listWorkspaces>>;
};

type Main = (token: string) => Promise<Envelope<ListWorkspacesResult>>;
export const main: Main = (token) => {
  const id = crypto.randomUUID();
  return resolveVoiceflowAuth(token)
    .then(listWorkspaces)
    .then((options) => success("list-workspaces", id, { options }))
    .catch((error) => failure("list-workspaces", id, error));
};

type ListWorkspacesEnvelope = Awaited<ReturnType<typeof main>>;
type ListWorkspacesRunner = Runner<ListWorkspacesEnvelope>;

type ListWorkspacesRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
};

type ReadListWorkspacesRequest = () => ListWorkspacesRequest;
const readListWorkspacesRequest: ReadListWorkspacesRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
});

type CreateListWorkspacesRunner = () => ListWorkspacesRunner;
export const createListWorkspacesRunner: CreateListWorkspacesRunner = () =>
  createRunner("list-workspaces", () => {
    const request = readListWorkspacesRequest();
    return main(requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT));
  });
