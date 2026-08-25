import type { AuthContext } from "./vf_auth";
import { isRetryableHttpStatus, requestBytes } from "./vf_http";
import { OperationFault } from "./vf_contracts";
export type ExportArtifact = {
  status: number;
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
};
const EXPORT_URL =
  "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/export-json";

type ParseSourceVersionID = (value: unknown) => string;
const parseSourceVersionID: ParseSourceVersionID = (value) => {
  if (typeof value !== "string" || !value.trim())
    throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
};

type ExportVersion = (
  auth: AuthContext,
  sourceVersionID: string,
) => Promise<ExportArtifact>;
export const exportVersion: ExportVersion = async (auth, sourceVersionID) => {
  const id = parseSourceVersionID(sourceVersionID);
  const response = await requestBytes({
    url: `${EXPORT_URL}/${encodeURIComponent(id)}`,
    init: { headers: { Authorization: `Bearer ${auth.token}` } },
    maxBytes: 50_000_000,
    timeoutMs: 30_000,
  });
  if (response.status < 200 || response.status >= 300)
    throw new OperationFault(
      "DEPENDENCY_FAILURE",
      isRetryableHttpStatus(response.status),
    );
  return {
    status: response.status,
    bytes: response.bytes,
    filename: `voiceflow-${id}.vf`,
    contentType: "application/octet-stream",
  };
};
