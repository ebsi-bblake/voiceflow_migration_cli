import { OperationFault } from "./vf_contracts";

export type AuthContext = Readonly<{ token: string; creatorID: string }>;
type Claims = Readonly<Record<string, unknown>>;

type IsClaims = (value: unknown) => value is Claims;
const isClaims: IsClaims = (value): value is Claims =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type NormalizeVoiceflowToken = (input: unknown) => string;
const normalizeVoiceflowToken: NormalizeVoiceflowToken = (input) => {
  if (typeof input !== "string")
    throw new OperationFault("AUTHENTICATION_FAILED");
  const token = input
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token || token.split(".").length !== 3)
    throw new OperationFault("AUTHENTICATION_FAILED");
  return token;
};

type DecodeClaims = (token: string) => Claims;
const decodeClaims: DecodeClaims = (token) => {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=");
    const value: unknown = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    if (!isClaims(value)) throw new Error();
    return value;
  } catch {
    throw new OperationFault("AUTHENTICATION_FAILED");
  }
};

type IsValidCreatorID = (value: string) => boolean;
const isValidCreatorID: IsValidCreatorID = (value) => {
  const creatorID = value.trim();
  return (
    creatorID.length > 0 &&
    Array.from(creatorID).length <= 128 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value) &&
    !/[\\/]/.test(value)
  );
};

type ExtractCreatorID = (claims: Claims) => string;
const extractCreatorID: ExtractCreatorID = (claims) => {
  const value =
    claims.creatorID ?? claims.userID ?? claims.user_id ?? claims.sub;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new OperationFault("AUTHENTICATION_FAILED");
  }
  const rawCreatorID = String(value);
  const creatorID = rawCreatorID.trim();
  if (!isValidCreatorID(rawCreatorID)) {
    throw new OperationFault("AUTHENTICATION_FAILED");
  }
  return creatorID;
};

type AuthContextFromToken = (token: string) => AuthContext;
const authContextFromToken: AuthContextFromToken = (token) => ({
  token,
  creatorID: extractCreatorID(decodeClaims(token)),
});

type AcquireVoiceflowToken = (input: unknown) => Promise<string>;
const acquireVoiceflowToken: AcquireVoiceflowToken = (input) =>
  Promise.resolve().then(() => normalizeVoiceflowToken(input));

type ResolveVoiceflowAuth = (input: unknown) => Promise<AuthContext>;
export const resolveVoiceflowAuth: ResolveVoiceflowAuth = (input) =>
  acquireVoiceflowToken(input).then(authContextFromToken);
