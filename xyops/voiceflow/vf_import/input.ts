import { OperationFault } from "../vf_contracts";
import { requireVoiceflowString } from "../vf_validation";
import { isRecord } from "../guards";
import type { ImportedReceipt } from "../types";

type RecordValue = Readonly<Record<string, unknown>>;

type RequiredFolderID = (value: unknown) => string;
export const requiredFolderID: RequiredFolderID = (value) => {
  const folderID = requireVoiceflowString(value);
  if (!isNumericFolder(folderID)) {
    throw new OperationFault("INVALID_ARGUMENT");
  }
  return folderID;
};

type ValidFilename = (value: string) => string;
export const validFilename: ValidFilename = (value) => {
  const name = value.trim();
  if (!isSafeFilename(name))
    throw new OperationFault("INVALID_ARGUMENT");
  return name;
};
const isNumericFolder = (value: string): boolean => /^\d+$/.test(value);
const isSafeFilename = (value: string): boolean => {
  if (!/^[^/\\]+\.vf$/i.test(value)) return false;
  return !value.includes("..");
};

type PrimitiveID = (value: unknown) => string | undefined;
const primitiveID: PrimitiveID = (value) => {
  if (!isPrimitiveID(value)) return undefined;
  const id = String(value).trim();
  return nonEmptyID(id);
};
const nonEmptyID = (id: string): string | undefined => id === "" ? undefined : id;
const isPrimitiveID = (value: unknown): value is string | number => {
  if (typeof value === "string") return true;
  return typeof value === "number";
};

type NestedProjectID = (row: RecordValue) => string | undefined;
const nestedProjectID: NestedProjectID = (row) => {
  if (!isRecord(row.project)) return undefined;
  return primitiveID(row.project._id);
};

type Receipt = (
  value: unknown,
  status: number,
  bytes: number,
) => ImportedReceipt;
export const receipt: Receipt = (value, status, bytes) => {
  if (!isRecord(value)) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return receiptFromRecord(value, status, bytes);
};
const receiptFromRecord = (value: RecordValue, status: number, bytes: number): ImportedReceipt => {
  const projectID = projectIDFromRecord(value);
  if (projectID === undefined) throw new OperationFault("IMPORT_OUTCOME_UNKNOWN");
  return {
    importStatus: status,
    importBytes: bytes,
    projectID,
    assistantID: primitiveID(value.assistantID),
    workspaceID: primitiveID(value.workspaceID),
    folderID: primitiveID(value.folderID),
  };
};
const projectIDFromRecord = (value: RecordValue): string | undefined =>
  firstProjectID(value) ?? nestedProjectID(value);
export const firstProjectID = (value: RecordValue): string | undefined =>
  [value.projectID, value.projectId, value.id].map(primitiveID).find((id) => id !== undefined);

