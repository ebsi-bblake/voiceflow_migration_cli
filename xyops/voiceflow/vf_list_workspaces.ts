import { listWorkspaces } from "./vf_catalog";
import { resolveVoiceflowAuth } from "./vf_auth";
import { success, failure } from "./vf_contracts";
import type { Envelope } from "./types";
import { createUUID } from "./vf_uuid";

type ListWorkspacesResult = {
  options: Awaited<ReturnType<typeof listWorkspaces>>;
};

type Main = (token: string) => Promise<Envelope<ListWorkspacesResult>>;
export const main: Main = (token) => {
  const id = createUUID();
  return resolveVoiceflowAuth(token)
    .then(listWorkspaces)
    .then((options) => success("list_workspaces", id, { options }))
    .catch((error) => failure("list_workspaces", id, error));
};
