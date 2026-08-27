import { resolveVoiceflowAuth } from "./vf_auth";
import { listVersions } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";
import { createUUID } from "./vf_uuid";

type ListVersionsResult = {
  options: Awaited<ReturnType<typeof listVersions>>;
};

type ListVersionsForSelection = (
  sourceWorkspaceID: string,
  sourceProjectID: string,
) => (auth: Parameters<typeof listVersions>[0]) =>
  ReturnType<typeof listVersions>;
const listVersionsForSelection: ListVersionsForSelection = (
  sourceWorkspaceID,
  sourceProjectID,
) => (auth) => listVersions(auth, sourceWorkspaceID, sourceProjectID);

type Main = (
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
) => Promise<Envelope<ListVersionsResult>>;
export const main: Main = (token, sourceWorkspaceID, sourceProjectID) => {
  const id = createUUID();
  return resolveVoiceflowAuth(token)
    .then(listVersionsForSelection(sourceWorkspaceID, sourceProjectID))
    .then((options) => success("list-versions", id, { options }))
    .catch((error) => failure("list-versions", id, error));
};
