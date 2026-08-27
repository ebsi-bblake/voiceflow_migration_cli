import { OperationFault } from "./vf_contracts";

type RequireVoiceflowString = (value: unknown) => string;
export const requireVoiceflowString: RequireVoiceflowString = (value) => {
  if (!isNonEmptyString(value)) {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return value.trim();
};
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";
