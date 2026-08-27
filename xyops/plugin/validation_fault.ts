import type { PluginValidationCode } from "./types";

export class PluginValidationFault extends Error {
  constructor(
    public readonly code: PluginValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginValidationFault";
  }
}
