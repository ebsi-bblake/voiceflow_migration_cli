import type { AuthContext } from "./jwt_authentication_context.ts";

export const VOICEFLOW_API_BASE_URL =
  "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 50_000_000;
const responseRequests = new WeakMap<Response, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>();
const validateAuth = (auth: AuthContext) => {
  if (!auth || typeof auth.token !== "string" || !auth.token || typeof auth.creatorID !== "string" || !auth.creatorID)
    throw new Error("Invalid authentication context");
};

export function voiceflowUrl(path: string, id?: string): string {
  return `${VOICEFLOW_API_BASE_URL}/${path}${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
}

export function bearerHeaders(auth: AuthContext, accept = "application/json") {
  validateAuth(auth);
  return {
    Authorization: `Bearer ${auth.token}`,
    Accept: accept,
    "Cache-Control": "no-cache",
  };
}

export async function fetchVoiceflow(
  phase: "Export" | "Import",
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${phase} failed with HTTP ${response.status}`);
    responseRequests.set(response, { controller, timer });
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && /^((Export|Import) failed with HTTP)/.test(error.message)) throw error;
    throw new Error(`${phase} request failed`);
  }
}

export async function readResponseBytes(response: Response, phase: "Export" | "Import") {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES)
    throw new Error(`${phase} response is too large`);
  const request = responseRequests.get(response);
  // Responses from fetchVoiceflow share one deadline for headers and body.
  if (!request) throw new Error(`${phase} response read failed`);
  try {
    if (!response.body) throw new Error(`${phase} response has no readable body`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error(`${phase} response is too large`); }
      chunks.push(part.value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  } catch (error) {
    if (error instanceof Error && error.message === `${phase} response is too large`) throw error;
    throw new Error(`${phase} response read failed`);
  } finally {
    request.controller.abort();
    clearTimeout(request.timer);
    responseRequests.delete(response);
  }
}

export async function readResponseJson(response: Response, phase: "Export" | "Import"): Promise<unknown> {
  const bytes = await readResponseBytes(response, phase);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${phase} response was not JSON`);
  }
}
