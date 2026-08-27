import type { AuthContext } from "./types";
import { requestBytes } from "./vf_http";
import { isRecord } from "./guards";
import type { ApiKeyDiagnostic, ApiKeyStatus } from "./types";

export type { ApiKeyDiagnostic, ApiKeyStatus } from "./types";

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

type KeyCandidates = (value: unknown) => string[];
const keyCandidates: KeyCandidates = (value) => {
  if (typeof value === "string") return [value.trim()];
  return recordKeyCandidates(value);
};
const recordKeyCandidates = (value: unknown): string[] => {
  if (!isRecord(value)) return [];
  return keyFields.flatMap((field) => stringValue(value[field]));
};
const keyFields = ["apiKey", "api_key", "key", "token"] as const;
const stringValue = (value: unknown): string[] => typeof value === "string" ? [value.trim()] : [];

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
  const id = normalizeProjectID(projectID);
  if (!id) return missingProjectApiKeyOutcome();
  return retrieveApiKeyStatusForProject(auth, id);
};
const retrieveApiKeyStatusForProject = async (auth: AuthContext, id: string): Promise<ApiKeyStatus> =>
  retrieveValidatedApiKey(auth, id).catch(() => failedApiKeyRetrievalOutcome());
const retrieveValidatedApiKey = async (auth: AuthContext, id: string): Promise<ApiKeyStatus> => {
  const response = await requestBytes({ url: `https://identity-api.empyrean.voiceflow.com/v1alpha1/api-key/legacy/project/${encodeURIComponent(id)}`, init: { method: "POST", headers: { Authorization: `Bearer ${auth.token}` } }, maxBytes: 1_048_576, timeoutMs: 30_000 });
  const keys = deduplicateStrings(selectVoiceflowApiKeys(parseKeys(response.bytes)));
  if (!isSuccessfulApiKeyResponse(response.status, keys)) throw new Error("retrieval failed");
  return successfulApiKeyOutcome();
};
const isSuccessfulApiKeyResponse = (status: number, keys: readonly string[]): boolean => {
  return isSuccessfulStatus(status) && hasSingleKey(keys);
};
const normalizeProjectID = (projectID: string | undefined): string | undefined =>
  projectID === undefined ? undefined : projectID.trim();
const isSuccessfulStatus = (status: number): boolean => status >= 200 && status < 300;
const hasSingleKey = (keys: readonly string[]): boolean => keys.length === 1;
