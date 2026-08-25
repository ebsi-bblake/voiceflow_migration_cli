import type { AuthContext } from "./vf_auth";
import { requestBytes } from "./vf_http";

export type ApiKeyDiagnostic = {
  readonly code: string;
  readonly message: string;
};
export type ApiKeyStatus =
  | {
      readonly apiKeyRetrieved: true;
      readonly postImport?: never;
    }
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

type SuccessfulApiKeyOutcome = () => ApiKeyStatus;
const successfulApiKeyOutcome: SuccessfulApiKeyOutcome = () => {
  return { apiKeyRetrieved: true };
};

type FailedApiKeyOutcome = (diagnostic: ApiKeyDiagnostic) => ApiKeyStatus;
const failedApiKeyOutcome: FailedApiKeyOutcome = (diagnostic) => {
  return {
    apiKeyRetrieved: false,
    postImport: {
      apiKeyRetrieved: false,
      diagnostic,
    },
  };
};

type MissingProjectApiKeyOutcome = () => ApiKeyStatus;
const missingProjectApiKeyOutcome: MissingProjectApiKeyOutcome = () => {
  return failedApiKeyOutcome(PROJECT_ID_UNAVAILABLE);
};

type FailedApiKeyRetrievalOutcome = () => ApiKeyStatus;
const failedApiKeyRetrievalOutcome: FailedApiKeyRetrievalOutcome = () => {
  return failedApiKeyOutcome(API_KEY_RETRIEVAL_FAILED);
};

type IsRecord = (value: unknown) => value is Readonly<Record<string, unknown>>;
const isRecord: IsRecord = (
  value,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type KeyCandidates = (value: unknown) => string[];
const keyCandidates: KeyCandidates = (value) => {
  if (typeof value === "string") return [value.trim()];
  if (!isRecord(value)) return [];
  return [value.apiKey, value.api_key, value.key, value.token]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim());
};

type ParseKeys = (bytes: ArrayBuffer) => string[];
const parseKeys: ParseKeys = (bytes) => {
  const text = new TextDecoder().decode(bytes).trim();
  try {
    const value: unknown = JSON.parse(text);
    return keyCandidates(value);
  } catch {
    return keyCandidates(text);
  }
};

type SelectVoiceflowApiKeys = (keys: readonly string[]) => string[];
const selectVoiceflowApiKeys: SelectVoiceflowApiKeys = (keys) =>
  keys.filter((key) => /^VF\.DM\..+/.test(key));

type DeduplicateStrings = (values: readonly string[]) => string[];
const deduplicateStrings: DeduplicateStrings = (values) => [
  ...new Set(values),
];

type RetrieveApiKeyStatus = (
  auth: AuthContext,
  projectID?: string,
) => Promise<ApiKeyStatus>;
export const retrieveApiKeyStatus: RetrieveApiKeyStatus = async (
  auth,
  projectID,
) => {
  const id = projectID?.trim();
  if (!id) {
    return missingProjectApiKeyOutcome();
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
    const keys = deduplicateStrings(
      selectVoiceflowApiKeys(parseKeys(response.bytes)),
    );
    if (response.status < 200 || response.status >= 300 || keys.length !== 1)
      throw new Error("retrieval failed");
    return successfulApiKeyOutcome();
  } catch {
    return failedApiKeyRetrievalOutcome();
  }
};
