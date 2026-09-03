/** Centralized regular expressions used by the Windmill Voiceflow scripts. */
export const VoiceflowRegex = {
  bearerPrefix: /^Bearer\s+/i,
  base64UrlDash: /-/g,
  base64UrlUnderscore: /_/g,
  // This range intentionally includes C0 and C1 control characters.
  // eslint-disable-next-line no-control-regex
  controlCharacter: new RegExp("[\\u0000-\\u009f]"),
  creatorID: /^[A-Za-z0-9_-]{1,128}$/,
  diagnosticStage: /stage=[a-z-]+/i,
  filename: /^[^/\\]+\.vf$/i,
  projectAPIKey: /^VF\.DM\..+/,
  pathSeparator: /[\\/]/,
  trailingSlashes: /\/+$/,
  voiceflowAPIKey: /VF\.DM\.[^\s"']+/gi,
  redactedBearer: /Bearer\s+[^\s]+/gi,
  redactedURL: /https?:\/\/[^\s"']+/gi,
  whitespace: /\s+/g,
  numericID: /^\d+$/,
  quotedSecretValue: /^(".*"|'.*')$/u,
  secretName: /^[A-Za-z_][A-Za-z0-9_]*$/,
  secretLineBreak: /\r?\n/,
} as const;
