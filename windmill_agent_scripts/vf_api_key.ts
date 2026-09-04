import type { AuthContext } from "./vf_auth";
import { VoiceflowRegex } from "./vf_regex";
import { requestBytes } from "./vf_http";
import { OperationFault } from "./vf_contracts";

export type ApiKeyDiagnostic = {
  readonly code: string;
  readonly message: string;
};

export type ApiKeyStatus =
  | { readonly apiKeyRetrieved: true; readonly postImport?: never }
  | {
      readonly apiKeyRetrieved: false;
      readonly postImport: {
        readonly apiKeyRetrieved: false;
        readonly diagnostic: ApiKeyDiagnostic;
      };
    };

const API_KEY_RETRIEVAL_FAILED: ApiKeyDiagnostic = {
  code: "API_KEY_RETRIEVAL_FAILED",
  message: "Project API key could not be retrieved.",
};
const PROJECT_ID_UNAVAILABLE: ApiKeyDiagnostic = {
  code: "PROJECT_ID_UNAVAILABLE",
  message: "Imported project ID was unavailable.",
};

function successfulApiKeyOutcome(): ApiKeyStatus {
  return { apiKeyRetrieved: true };
}

function failedApiKeyOutcome(diagnostic: ApiKeyDiagnostic): ApiKeyStatus {
  return {
    apiKeyRetrieved: false,
    postImport: { apiKeyRetrieved: false, diagnostic },
  };
}

function missingProjectApiKeyOutcome(): ApiKeyStatus {
  return failedApiKeyOutcome(PROJECT_ID_UNAVAILABLE);
}

function failedApiKeyRetrievalOutcome(): ApiKeyStatus {
  return failedApiKeyOutcome(API_KEY_RETRIEVAL_FAILED);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

function recordKeyCandidates(value: Record<string, unknown>): string[] {
  return [value.apiKey, value.api_key, value.key, value.token]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim());
}

function recordOrEmptyCandidates(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return recordKeyCandidates(value);
}

function keyCandidates(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()];
  return recordOrEmptyCandidates(value);
}

function parseKeys(bytes: ArrayBuffer): string[] {
  const text = new TextDecoder().decode(bytes).trim();
  try {
    return keyCandidates(JSON.parse(text));
  } catch {
    return keyCandidates(text);
  }
}

function isVoiceflowAPIKey(value: string): boolean {
  return VoiceflowRegex.projectAPIKey.test(value);
}

function readSingleAPIKey(bytes: ArrayBuffer): string | undefined {
  const keys = [...new Set(parseKeys(bytes).filter(isVoiceflowAPIKey))];
  return keys.length === 1 ? keys[0] : undefined;
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function normalizeNonEmptyID(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeProjectID(projectID: string | undefined): string | undefined {
  if (projectID === undefined) return undefined;
  return normalizeNonEmptyID(projectID);
}

export function retrieveProjectAPIKeyValue(
  auth: AuthContext,
  projectID: string,
): Promise<string> {
  return requestBytes({
    url: `https://identity-api.empyrean.voiceflow.com/v1alpha1/api-key/legacy/project/${encodeURIComponent(projectID)}`,
    init: {
      method: "POST",
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${auth.token}`,
      },
      body: null,
    },
    maxBytes: 1_048_576,
    timeoutMs: 30_000,
  })
    .then((response) =>
      (() => {
        const key = readSingleAPIKey(response.bytes);
        if (!isSuccessfulStatus(response.status))
          throw new OperationFault(
            "DEPENDENCY_FAILURE",
            true,
            `api-key-http-${response.status}`,
          );
        if (key === undefined)
          throw new OperationFault("DEPENDENCY_FAILURE", true, "api-key-response");
        return key;
      })(),
    )
    .catch((error: unknown) => {
      if (error instanceof OperationFault) throw error;
      throw new OperationFault("DEPENDENCY_FAILURE", true);
    });
}

function retrieveProjectAPIKey(
  auth: AuthContext,
  projectID: string,
): Promise<ApiKeyStatus> {
  return retrieveProjectAPIKeyValue(auth, projectID)
    .then(() => successfulApiKeyOutcome())
    .catch(() => failedApiKeyRetrievalOutcome());
}

export function retrieveApiKeyStatus(
  auth: AuthContext,
  projectID?: string,
): Promise<ApiKeyStatus> {
  const id = normalizeProjectID(projectID);
  return id === undefined
    ? Promise.resolve(missingProjectApiKeyOutcome())
    : retrieveProjectAPIKey(auth, id);
}
