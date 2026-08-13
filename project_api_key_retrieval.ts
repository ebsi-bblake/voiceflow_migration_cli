import type { AuthContext } from "./jwt_authentication_context.ts";
import {
  fetchVoiceflow,
  identityApiKeyUrl,
  identityBearerHeaders,
  readResponseBytes,
} from "./http_api_client.ts";
import { diagnostic } from "./migration_diagnostics.ts";

const MAX_RESPONSE_BYTES = 1_000_000;
const VALID_KEY = /^VF\.DM\..+$/;

export async function retrieveProjectApiKey(
  auth: AuthContext,
  projectID: string,
): Promise<string> {
  if (
    !auth ||
    typeof auth.token !== "string" ||
    !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(auth.token) ||
    typeof auth.creatorID !== "string" ||
    !auth.creatorID.trim() ||
    typeof projectID !== "string" ||
    !projectID.trim()
  )
    throw diagnostic("API-key retrieval", "invalid-input");
  {
    const response = await fetchVoiceflow(
      "API-key retrieval",
      identityApiKeyUrl(projectID.trim()),
      {
        method: "POST",
        headers: identityBearerHeaders(auth),
        credentials: "omit",
      },
    );
    const bytes = await readResponseBytes(
      response,
      "API-key retrieval",
      MAX_RESPONSE_BYTES,
    );
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      value = new TextDecoder().decode(bytes);
    }
    const candidates: string[] = [];
    if (typeof value === "string" && VALID_KEY.test(value.trim()))
      candidates.push(value.trim());
    if (value && typeof value === "object" && !Array.isArray(value))
      for (const field of ["apiKey", "api_key", "key", "token"]) {
        const candidate = (value as Record<string, unknown>)[field];
        if (typeof candidate === "string" && VALID_KEY.test(candidate.trim()))
          candidates.push(candidate.trim());
      }
    const distinct = [...new Set(candidates)];
    if (distinct.length === 0) throw diagnostic("API-key retrieval", "api-key-missing", { endpoint: "identity", status: response.status });
    if (distinct.length !== 1) throw diagnostic("API-key retrieval", "api-key-ambiguous", { endpoint: "identity", status: response.status });
    return distinct[0];
  }
}
