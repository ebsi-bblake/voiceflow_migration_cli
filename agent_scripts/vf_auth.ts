import { OperationFault } from "./vf_contracts";
export type AuthContext = { token: string; creatorID: string };
async function acquireVoiceflowToken(input: unknown): Promise<string> {
  if (typeof input !== "string")
    throw new OperationFault("AUTHENTICATION_FAILED");
  const token = input
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token || token.split(".").length !== 3)
    throw new OperationFault("AUTHENTICATION_FAILED");
  return token;
}
function decodeClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new OperationFault("AUTHENTICATION_FAILED");
  }
}
function extractCreatorID(claims: Record<string, unknown>): string {
  const value =
    claims.creatorID ?? claims.userID ?? claims.user_id ?? claims.sub;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new OperationFault("AUTHENTICATION_FAILED");
  }
  const creatorID = String(value).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(creatorID)) {
    throw new OperationFault("AUTHENTICATION_FAILED");
  }
  return creatorID;
}
export async function resolveVoiceflowAuth(
  input: unknown,
): Promise<AuthContext> {
  const token = await acquireVoiceflowToken(input);
  return { token, creatorID: extractCreatorID(decodeClaims(token)) };
}
