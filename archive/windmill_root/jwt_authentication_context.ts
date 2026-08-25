import { diagnostic } from "./migration_diagnostics";
export type AuthContext = {
  readonly token: string;
  readonly creatorID: string;
};
type Claims = Record<string, unknown>;

function normalizeRawToken(rawToken: unknown): string {
  if (typeof rawToken !== "string" || !rawToken.trim())
    throw diagnostic("Authentication", "invalid-input");
  return rawToken.trim();
}

function validateJWTShape(token: string): string {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
    throw diagnostic("Authentication", "authentication-failed");
  return token.split(".")[1];
}

function decodeAndParseClaims(claimPart: string): Claims {
  try {
    const part = claimPart.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")),
          (c) => c.charCodeAt(0),
        ),
      ),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw diagnostic("Authentication", "authentication-failed");
    return parsed as Claims;
  } catch {
    throw diagnostic("Authentication", "authentication-failed");
  }
}

function selectCreatorClaim(claims: Claims): unknown {
  return claims.creatorID ?? claims.userID ?? claims.user_id ?? claims.sub;
}

function normalizeCreatorID(id: unknown): string {
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    String(id).trim() === ""
  )
    throw diagnostic("Authentication", "authentication-failed");
  return String(id);
}

export function authenticate(rawToken: unknown): AuthContext {
  const token = normalizeRawToken(rawToken);
  const claimPart = validateJWTShape(token);
  const claims = decodeAndParseClaims(claimPart);
  const creatorID = normalizeCreatorID(selectCreatorClaim(claims));
  return { token, creatorID };
}
