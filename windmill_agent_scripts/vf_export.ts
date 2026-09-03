import type { AuthContext } from "./vf_auth";
import { isRetryableHttpStatus, requestBytes } from "./vf_http";
import { OperationFault } from "./vf_contracts";
import { VOICEFLOW_REALTIME_HTTP_ORIGIN, encodePathSegment } from "./vf_urls";
export type ExportArtifact = {
  status: number;
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
};
const EXPORT_URL = `${VOICEFLOW_REALTIME_HTTP_ORIGIN}/v1alpha1/assistant/export-json`;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSourceVersionID(value: unknown): string {
  if (!isNonEmptyString(value)) throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
}

function isUnsuccessfulStatus(status: number): boolean {
  return status < 200 || status >= 300;
}

function validateExportStatus(status: number): void {
  if (isUnsuccessfulStatus(status))
    throw new OperationFault(
      "DEPENDENCY_FAILURE",
      isRetryableHttpStatus(status),
    );
}

export async function exportVersion(
  auth: AuthContext,
  sourceVersionID: string,
): Promise<ExportArtifact> {
  const id = parseSourceVersionID(sourceVersionID);
  const response = await requestBytes({
    url: `${EXPORT_URL}/${encodePathSegment(id)}`,
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
}
