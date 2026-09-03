import { OperationFault } from "./vf_contracts";
export const VOICEFLOW_CREATOR_ORIGIN = "https://creator.empyrean.voiceflow.com";
export const VOICEFLOW_IDENTITY_ORIGIN = "https://identity-api.empyrean.voiceflow.com";
export const VOICEFLOW_REALTIME_HTTP_ORIGIN = "https://realtime-http-api.empyrean.voiceflow.com";
export const VOICEFLOW_REALTIME_WEBSOCKET_URL = "wss://realtime.empyrean.voiceflow.com/";
export const encodePathSegment = (value: string): string => encodeURIComponent(value);
export const parseXYOpsURL = (value: string): string => {
  let url: URL;
  try { url = new URL(value); } catch { throw new OperationFault("INVALID_ARGUMENT"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new OperationFault("INVALID_ARGUMENT");
  return url.toString().replace(/\/+$/, "");
};
