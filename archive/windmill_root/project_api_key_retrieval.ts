import type { AuthContext } from "./jwt_authentication_context";
import {
  fetchVoiceflow,
  identityApiKeyUrl,
  identityBearerHeaders,
  readResponseBytes,
} from "./http_api_client";
import { diagnostic } from "./migration_diagnostics";

const MAX_RESPONSE_BYTES = 1_000_000;
const VALID_KEY = /^VF\.DM\..+$/;

function isValidVoiceflowDataManagerKey(value: unknown): value is string {
  return typeof value === "string" && VALID_KEY.test(value.trim());
}

function extractApiKeyCandidates(value: unknown): string[] {
  const candidates: string[] = [];
  if (isValidVoiceflowDataManagerKey(value)) candidates.push(value.trim());
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const field of ["apiKey", "api_key", "key", "token"]) {
      const candidate = record[field];
      if (isValidVoiceflowDataManagerKey(candidate)) candidates.push(candidate.trim());
    }
  }
  return candidates;
}

function deduplicateApiKeyCandidates(candidates: string[]): string[] {
  return [...new Set(candidates)];
}

function resolveExactlyOneApiKey(
  candidates: string[],
  responseStatus: number,
): string {
  const distinct = deduplicateApiKeyCandidates(candidates);
  const context = { endpoint: "identity", status: responseStatus };
  if (distinct.length === 0) throw diagnostic("API-key retrieval", "api-key-missing", context);
  if (distinct.length !== 1) throw diagnostic("API-key retrieval", "api-key-ambiguous", context);
  return distinct[0];
}

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
    return resolveExactlyOneApiKey(extractApiKeyCandidates(value), response.status);
  }
}
