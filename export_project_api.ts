import type { AuthContext } from "./jwt_authentication_context.ts";
import type { ExportArtifact } from "./shared_contract_types.ts";
import {
  bearerHeaders,
  fetchVoiceflow,
  readResponseBytes,
  voiceflowUrl,
} from "./http_api_client.ts";
import { diagnostic } from "./migration_diagnostics.ts";
export async function exportVersion(
  auth: AuthContext,
  sourceVersionID: string,
): Promise<ExportArtifact> {
  if (typeof auth?.token !== "string" || typeof auth?.creatorID !== "string")
    throw diagnostic("Export", "invalid-input");
  if (typeof sourceVersionID !== "string" || !sourceVersionID.trim())
    throw diagnostic("Export", "invalid-input");
  const r = await fetchVoiceflow(
    "Export",
    voiceflowUrl("export-json", sourceVersionID),
    { headers: bearerHeaders(auth) },
  );
  const bytes = await readResponseBytes(r, "Export");
  return {
    bytes,
    filename: "voiceflow-export.vf",
    contentType: "application/octet-stream",
    status: r.status,
  };
}
