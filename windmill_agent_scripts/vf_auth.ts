import { OperationFault } from "./vf_contracts";

export type AuthContext = { token: string; creatorID: string };
type Claims = Record<string, unknown>;

function requireTokenInput(input: unknown): string {
  if (typeof input !== "string")
    throw new OperationFault("AUTHENTICATION_FAILED");
  return input
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function isJWTShape(token: string): boolean {
  return token.length > 0 && token.split(".").length === 3;
}

async function acquireVoiceflowToken(input: unknown): Promise<string> {
  const token = requireTokenInput(input);
  if (!isJWTShape(token)) throw new OperationFault("AUTHENTICATION_FAILED");
  return token;
}

function decodePayload(token: string): string {
  const part = token.split(".")[1];
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isClaims(value: unknown): value is Claims {
  return isObject(value) && !Array.isArray(value);
}

function requireClaims(value: unknown): Claims {
  if (!isClaims(value)) throw new Error();
  return value;
}

function decodeClaims(token: string): Claims {
  try {
    return requireClaims(JSON.parse(decodePayload(token)));
  } catch {
    throw new OperationFault("AUTHENTICATION_FAILED");
  }
}

function isPresentClaim(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function readCreatorClaim(claims: Claims): unknown {
  return [claims.creatorID, claims.userID, claims.user_id, claims.sub].find(
    isPresentClaim,
  );
}

function isCreatorID(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function isValidCreatorID(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function requireCreatorIDValue(value: unknown): string | number {
  if (!isCreatorID(value)) throw new OperationFault("AUTHENTICATION_FAILED");
  return value;
}

function requireValidCreatorID(creatorID: string): string {
  if (!isValidCreatorID(creatorID))
    throw new OperationFault("AUTHENTICATION_FAILED");
  return creatorID;
}

function requireCreatorID(value: unknown): string {
  return requireValidCreatorID(String(requireCreatorIDValue(value)).trim());
}

function extractCreatorID(claims: Claims): string {
  return requireCreatorID(readCreatorClaim(claims));
}

export async function resolveVoiceflowAuth(
  input: unknown,
): Promise<AuthContext> {
  const token = await acquireVoiceflowToken(input);
  return { token, creatorID: extractCreatorID(decodeClaims(token)) };
}
