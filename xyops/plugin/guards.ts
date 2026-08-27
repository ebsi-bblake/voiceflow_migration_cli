import { supportedPluginOperations } from "./operations";
import type { PluginOperation } from "./types";

type RecordValue = Readonly<Record<string, unknown>>;

type IsRecord = (value: unknown) => value is RecordValue;
export const isRecord: IsRecord = (value): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type IsNonEmptyString = (value: unknown) => value is string;
export const isNonEmptyString: IsNonEmptyString = (value): value is string =>
  typeof value === "string" && value.trim().length > 0;

type IsPluginOperation = (value: unknown) => value is PluginOperation;
export const isPluginOperation: IsPluginOperation = (
  value,
): value is PluginOperation =>
  typeof value === "string" &&
  supportedPluginOperations.some((operation) => operation === value);
