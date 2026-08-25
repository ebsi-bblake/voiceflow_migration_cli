import { resolveVoiceflowAuth } from "./vf_auth";
import {
  failure,
  success,
  type Envelope,
  OperationFault,
} from "./vf_contracts";
import { isRetryableHttpStatus, requestBytes } from "./vf_http";
export async function main(
  token: string,
): Promise<
  Envelope<{ active: boolean; loginRequired?: boolean; loginUrl?: string }>
> {
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
    if (response.status === 401 || response.status === 403) {
      return success(operation, id, {
        active: false,
        loginRequired: true,
        loginUrl: "https://creator.empyrean.voiceflow.com/",
      });
    }
    if (response.status < 200 || response.status >= 300)
      throw new OperationFault(
        "DEPENDENCY_FAILURE",
        isRetryableHttpStatus(response.status),
      );
    return success(operation, id, { active: true });
  } catch (error) {
    return failure(operation, id, error);
  }
}
