import type { AuthContext } from "./types";
import { isRetryableHttpStatus } from "./guards";
import { requestBytes } from "./vf_http";
import { OperationFault } from "./vf_contracts";
import { requireVoiceflowString } from "./vf_validation";
import type { ExportArtifact } from "./types";
export type { ExportArtifact } from "./types";
const EXPORT_URL =
  "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/export-json";

type ExportVersion = (
  auth: AuthContext,
  sourceVersionID: string,
) => Promise<ExportArtifact>;
export const exportVersion: ExportVersion = async (auth, sourceVersionID) => {
  const id = requireVoiceflowString(sourceVersionID);
  const response = await requestBytes({
    url: `${EXPORT_URL}/${encodeURIComponent(id)}`,
    init: { headers: { Authorization: `Bearer ${auth.token}` } },
    maxBytes: 50_000_000,
    timeoutMs: 30_000,
  });
  validateExportStatus(response.status);
  return {
    status: response.status,
    bytes: response.bytes,
    filename: `voiceflow-${id}.vf`,
    contentType: "application/octet-stream",
  };
};
const validateExportStatus = (status: number): void => {
  if (!isSuccessfulExportStatus(status))
    throw new OperationFault("DEPENDENCY_FAILURE", isRetryableHttpStatus(status));
};
const isSuccessfulExportStatus = (status: number): boolean => status >= 200 && status < 300;
