import { OperationFault } from "./vf_contracts";

const parseString = (value: unknown, maximum: number): string => {
  if (typeof value !== "string") throw new OperationFault("INVALID_ARGUMENT");
  const normalized = value.trim();
  const hasControl = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
  if (!normalized || Array.from(normalized).length > maximum || hasControl || /[\\/]/.test(normalized))
    throw new OperationFault("INVALID_ARGUMENT");
  return normalized;
};
export const parseWorkspaceID = (value: unknown): string => parseString(value, 128);
export const parseProjectID = (value: unknown): string => parseString(value, 128);
export const parseVersionID = (value: unknown): string => parseString(value, 128);
export const parseCreatorID = (value: unknown): string => parseString(value, 128);
export const parseFolderName = (value: unknown): string => parseString(value, 256);
export const parseFolderID = (value: unknown): string => {
  const id = parseString(value, 128);
  if (!/^\d+$/.test(id)) throw new OperationFault("INVALID_ARGUMENT");
  return id;
};
export const parseSchemaVersion = (value: unknown): string => {
  if (typeof value !== "string") throw new OperationFault("INVALID_ARGUMENT");
  const schema = value.trim();
  if (!schema || Array.from(schema).length > 40 || /[\u0000-\u009f]/.test(schema))
    throw new OperationFault("INVALID_ARGUMENT");
  return schema;
};
export const parseEventOperation = (value: unknown): string => {
  const operation = parseString(value, 64);
  if (!new Set(["check_session", "list_workspaces", "list_projects", "list_versions", "list_folders", "plan_migration", "execute_migration"]).has(operation))
    throw new OperationFault("INVALID_ARGUMENT");
  return operation;
};
