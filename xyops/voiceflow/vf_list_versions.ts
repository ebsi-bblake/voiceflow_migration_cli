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
  const id = crypto.randomUUID();
  return resolveVoiceflowAuth(token)
    .then(listVersionsForSelection(sourceWorkspaceID, sourceProjectID))
    .then((options) => success("list-versions", id, { options }))
    .catch((error) => failure("list-versions", id, error));
};

type ListVersionsEnvelope = Awaited<ReturnType<typeof main>>;
type ListVersionsRunner = Runner<ListVersionsEnvelope>;

type ListVersionsRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
  readonly SOURCE_WORKSPACE_ID: string | undefined;
  readonly SOURCE_PROJECT_ID: string | undefined;
};

type ReadListVersionsRequest = () => ListVersionsRequest;
const readListVersionsRequest: ReadListVersionsRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
  SOURCE_WORKSPACE_ID: process.env.SOURCE_WORKSPACE_ID,
  SOURCE_PROJECT_ID: process.env.SOURCE_PROJECT_ID,
});

type CreateListVersionsRunner = () => ListVersionsRunner;
export const createListVersionsRunner: CreateListVersionsRunner = () =>
  createRunner("list-versions", () => {
    const request = readListVersionsRequest();
    return main(
      requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT),
      requireEnvironmentValue(
        "SOURCE_WORKSPACE_ID",
        request.SOURCE_WORKSPACE_ID,
      ),
      requireEnvironmentValue("SOURCE_PROJECT_ID", request.SOURCE_PROJECT_ID),
    );
  });
