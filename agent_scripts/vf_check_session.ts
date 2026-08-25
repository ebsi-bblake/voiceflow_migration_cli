import { resolveVoiceflowAuth } from "./vf_auth";
import {
  failure,
  success,
  type Envelope,
  OperationFault,
} from "./vf_contracts";
import {
  isRetryableHttpStatus,
  requestBytes,
  type HttpBytes,
} from "./vf_http";
import {
  createRunner,
  requireEnvironmentValue,
  type Runner,
} from "./runner_runtime";

type CheckSessionResult = {
  active: boolean;
  loginRequired?: boolean;
  loginUrl?: string;
};

type SessionResult = (response: HttpBytes) => CheckSessionResult;
const sessionResult: SessionResult = (response) => {
  if (response.status === 401 || response.status === 403) {
    return {
      active: false,
      loginRequired: true,
      loginUrl: "https://creator.empyrean.voiceflow.com/",
    };
  }
  if (response.status < 200 || response.status >= 300)
    throw new OperationFault(
      "DEPENDENCY_FAILURE",
      isRetryableHttpStatus(response.status),
    );
  return { active: true };
};

type Main = (token: string) => Promise<Envelope<CheckSessionResult>>;
export const main: Main = async (token) => {
  const operation = "check-session";
  const id = crypto.randomUUID();
  try {
    const auth = await resolveVoiceflowAuth(token);
    const response = await requestBytes({
      url: "https://identity-api.empyrean.voiceflow.com/v1alpha1/user",
      init: { headers: { Authorization: `Bearer ${auth.token}` } },
      maxBytes: 65536,
      timeoutMs: 15000,
    });
    return success(operation, id, sessionResult(response));
  } catch (error) {
    return failure(operation, id, error);
  }
};

type CheckSessionEnvelope = Awaited<ReturnType<typeof main>>;
type CheckSessionRunner = Runner<CheckSessionEnvelope>;

type CheckSessionRequest = {
  readonly VOICEFLOW_JWT: string | undefined;
};

type ReadCheckSessionRequest = () => CheckSessionRequest;
const readCheckSessionRequest: ReadCheckSessionRequest = () => ({
  VOICEFLOW_JWT: process.env.VOICEFLOW_JWT,
});

type CreateCheckSessionRunner = () => CheckSessionRunner;
export const createCheckSessionRunner: CreateCheckSessionRunner = () =>
  createRunner("check-session", () => {
    const request = readCheckSessionRequest();
    return main(requireEnvironmentValue("VOICEFLOW_JWT", request.VOICEFLOW_JWT));
  });
