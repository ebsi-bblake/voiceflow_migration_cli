import { diagnostic } from "./migration_diagnostics";
export type AuthContext = {
  readonly token: string;
  readonly creatorID: string;
};
type Claims = Record<string, unknown>;
export function authenticate(rawToken: unknown): AuthContext {
  if (typeof rawToken !== "string" || !rawToken.trim())
    throw diagnostic("Authentication", "invalid-input");
  const token = rawToken.trim();
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
    throw diagnostic("Authentication", "authentication-failed");
  let claims: Claims;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
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
    claims = parsed as Claims;
  } catch {
    throw diagnostic("Authentication", "authentication-failed");
  }
  const id = claims.creatorID ?? claims.userID ?? claims.user_id ?? claims.sub;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    String(id).trim() === ""
  )
    throw diagnostic("Authentication", "authentication-failed");
  return { token, creatorID: String(id) };
}
