import { OperationFault } from "./vf_contracts";

type RequireVoiceflowString = (value: unknown) => string;
export const requireVoiceflowString: RequireVoiceflowString = (value) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return value.trim();
};
