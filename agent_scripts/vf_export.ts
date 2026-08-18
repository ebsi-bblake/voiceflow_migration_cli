import type { AuthContext } from "./vf_auth";
import { requestBytes } from "./vf_http";
import { OperationFault } from "./vf_contracts";
export type ExportArtifact = {
  status: number;
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
};
const EXPORT_URL =
  "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/export-json";

function parseSourceVersionID(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new OperationFault("INVALID_ARGUMENT");
  return value.trim();
}

export async function exportVersion(
  auth: AuthContext,
  sourceVersionID: string,
): Promise<ExportArtifact> {
  const id = parseSourceVersionID(sourceVersionID);
  const response = await requestBytes({
    url: `${EXPORT_URL}/${encodeURIComponent(id)}`,
    init: { headers: { Authorization: `Bearer ${auth.token}` } },
    maxBytes: 50_000_000,
    timeoutMs: 30_000,
  });
  if (response.status < 200 || response.status >= 300)
    throw new OperationFault("DEPENDENCY_FAILURE");
  return {
    status: response.status,
    bytes: response.bytes,
    filename: `voiceflow-${id}.vf`,
    contentType: "application/octet-stream",
  };
}
