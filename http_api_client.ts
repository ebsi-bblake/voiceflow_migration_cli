import type { AuthContext } from "./jwt_authentication_context.ts";
import { codeForStatus, diagnostic, type MigrationPhase } from "./migration_diagnostics.ts";

export const VOICEFLOW_API_BASE_URL =
  "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant";
export const IDENTITY_API_BASE_URL =
  "https://identity-api.empyrean.voiceflow.com/v1alpha1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 50_000_000;
const responseRequests = new WeakMap<
  Response,
  { controller: AbortController; timer: ReturnType<typeof setTimeout>; deadlineFired: () => boolean }
>();
const validateAuth = (auth: AuthContext) => {
  if (
    !auth ||
    typeof auth.token !== "string" ||
    !auth.token ||
    typeof auth.creatorID !== "string" ||
    !auth.creatorID
  )
    throw new Error("Invalid authentication context");
};

export function voiceflowUrl(path: string, id?: string): string {
  return `${VOICEFLOW_API_BASE_URL}/${path}${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
}

export function identityApiKeyUrl(projectID: string): string {
  return `${IDENTITY_API_BASE_URL}/api-key/legacy/project/${encodeURIComponent(projectID)}`;
}

export const bearerHeaders = (auth: AuthContext, accept = "application/json") => {
  validateAuth(auth);
  return {
    Authorization: `Bearer ${auth.token}`,
    Accept: accept,
    "Cache-Control": "no-cache",
  };
}

export const identityBearerHeaders = (auth: AuthContext) => {
  return { ...bearerHeaders(auth, "*/*"), "Cache-Control": "no-store" };
}

export async function fetchVoiceflow(
  phase: "Export" | "Import" | "API-key retrieval",
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let deadlineFired = false;
  const timer = setTimeout(() => { deadlineFired = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) { response.body?.cancel(); throw diagnostic(phase, codeForStatus(response.status), { endpoint: phase === "API-key retrieval" ? "identity" : "voiceflow", status: response.status, contentType: response.headers.get("content-type") ?? undefined, requestId: response.headers.get("x-request-id") ?? undefined }); }
    responseRequests.set(response, { controller, timer, deadlineFired: () => deadlineFired });
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (
      error instanceof Error &&
      /^(Export|Import|API-key retrieval) failed with HTTP/.test(error.message)
    )
      throw error;
    if (error instanceof Error && error.name === "AbortError") throw diagnostic(phase, "timeout");
    if (error instanceof Error && error instanceof TypeError) throw diagnostic(phase, "network-error");
    throw error instanceof Error && error.name === "MigrationError" ? error : diagnostic(phase, "unknown");
  }
}

export const readResponseBytes = async (
  response: Response,
  phase: "Export" | "Import" | "API-key retrieval",
  maxBytes = MAX_BODY_BYTES,
) => {
  const request = responseRequests.get(response);
  // Responses from fetchVoiceflow share one deadline for headers and body.
  if (!request) throw diagnostic(phase, "unknown");
  try {
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      request.controller.abort();
      await response.body?.cancel();
      throw diagnostic(phase, "response-too-large", { responseSize: Number(declared), status: response.status, contentType: response.headers.get("content-type") ?? undefined });
    }
    if (!response.body)
      throw new Error(`${phase} response has no readable body`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw diagnostic(phase, "response-too-large", { responseSize: total, status: response.status });
      }
      chunks.push(part.value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  } catch (error) {
    if (error instanceof Error && error.name === "MigrationError")
      throw error;
    if (error instanceof Error && error.name === "AbortError" && request.deadlineFired()) throw diagnostic(phase, "timeout", { status: response.status });
    throw diagnostic(phase, "read-failure", { status: response.status });
  } finally {
    request.controller.abort();
    clearTimeout(request.timer);
    responseRequests.delete(response);
  }
};

export async function readResponseJson(
  response: Response,
  phase: "Export" | "Import" | "API-key retrieval",
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const bytes = await readResponseBytes(response, phase, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw diagnostic(phase, "invalid-json", { status: response.status, contentType: response.headers.get("content-type") ?? undefined });
  }
}
