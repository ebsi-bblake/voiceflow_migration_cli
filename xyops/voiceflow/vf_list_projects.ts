import { resolveVoiceflowAuth } from "./vf_auth";
import { listProjects } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";
import { createUUID } from "./vf_uuid";

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
  const id = createUUID();
  return resolveVoiceflowAuth(token)
    .then(listProjectsForWorkspace(sourceWorkspaceID))
    .then((options) => success("list-projects", id, { options }))
    .catch((error) => failure("list-projects", id, error));
};
