import type { AuthContext } from "./vf_auth";
import { requestBytes } from "./vf_http";

export type ApiKeyDiagnostic = { code: string; message: string };
export type ApiKeyStatus = {
  apiKeyRetrieved: boolean;
  postImport?: { apiKeyRetrieved: boolean; diagnostic: ApiKeyDiagnostic };
};
const FAILED = { code: "API_KEY_RETRIEVAL_FAILED", message: "Project API key could not be retrieved." };
const MISSING_PROJECT = { code: "PROJECT_ID_UNAVAILABLE", message: "Imported project ID was unavailable." };

function keyCandidates(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  return [row.apiKey, row.api_key, row.key, row.token]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim());
}

function parseKeys(bytes: ArrayBuffer): string[] {
  const text = new TextDecoder().decode(bytes).trim();
  try {
    return keyCandidates(JSON.parse(text));
  } catch {
    return keyCandidates(text);
  }
}

export async function retrieveApiKeyStatus(
  auth: AuthContext,
  projectID?: string,
): Promise<ApiKeyStatus> {
  const id = projectID?.trim();
  if (!id) {
    return {
      apiKeyRetrieved: false,
      postImport: { apiKeyRetrieved: false, diagnostic: MISSING_PROJECT },
    };
  }
  try {
    const response = await requestBytes({
      url: `https://identity-api.empyrean.voiceflow.com/v1alpha1/api-key/legacy/project/${encodeURIComponent(id)}`,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      },
      maxBytes: 1_048_576,
      timeoutMs: 30_000,
    });
    const keys = [...new Set(
      parseKeys(response.bytes).filter((key) => /^VF\.DM\..+/.test(key)),
    )];
    if (response.status < 200 || response.status >= 300 || keys.length !== 1) throw new Error("retrieval failed");
    return { apiKeyRetrieved: true };
  } catch {
    return {
      apiKeyRetrieved: false,
      postImport: { apiKeyRetrieved: false, diagnostic: FAILED },
    };
  }
}
