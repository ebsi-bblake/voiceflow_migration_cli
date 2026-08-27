import { resolveVoiceflowAuth } from "./vf_auth";
import {
  failure,
  success,
  OperationFault,
} from "./vf_contracts";
import { requestBytes } from "./vf_http";
import { isRetryableHttpStatus } from "./guards";
import type { Envelope, HttpBytes } from "./types";
import { createUUID } from "./vf_uuid";

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
  const id = createUUID();
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
