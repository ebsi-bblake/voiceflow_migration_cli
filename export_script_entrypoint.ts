import { authenticate } from "./jwt_authentication_context.ts";
import { exportVersion } from "./export_project_api.ts";
import { diagnostic } from "./migration_diagnostics.ts";

// token is the raw JWT only; do not pass a Bearer-prefixed value.

const MAX_EXPORT_BYTES = 50_000_000;

export type VoiceflowExportOutput = {
  filename: string;
  contentType: "application/octet-stream";
  byteLength: number;
  exportBase64: string;
};

const toBase64 = (bytes: ArrayBuffer): string => {
  const data = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 0x8000)
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  return btoa(binary);
};

export async function main(
  token: string,
  sourceVersionID: string,
): Promise<VoiceflowExportOutput> {
  if (typeof sourceVersionID !== "string" || !sourceVersionID.trim()) throw diagnostic("Export", "invalid-input");
  const artifact = await exportVersion(authenticate(token), sourceVersionID.trim());
  if (artifact.bytes.byteLength > MAX_EXPORT_BYTES)
    throw diagnostic("Export", "response-too-large");
  return {
    filename: artifact.filename,
    contentType: artifact.contentType,
    byteLength: artifact.bytes.byteLength,
    exportBase64: toBase64(artifact.bytes),
  };
}
