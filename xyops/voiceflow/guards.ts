export type RecordValue = Readonly<Record<string, unknown>>;
type IsRecord = (value: unknown) => value is RecordValue;
const isNonNullObject = (value: unknown): value is object => typeof value === "object" && value !== null;
export const isRecord: IsRecord = (value): value is RecordValue =>
  isNonNullObject(value) && !Array.isArray(value);
type IsObject = IsRecord;
export const isObject: IsObject = isRecord;
type IsClaims = IsRecord;
export const isClaims: IsClaims = isRecord;
type IsRawRow = IsRecord;
export const isRawRow: IsRawRow = isRecord;
type IsRowArray = (value: unknown) => value is readonly RecordValue[];
export const isRowArray: IsRowArray = (value) =>
  Array.isArray(value) && value.every(isRecord);
type IsValidCreatorID = (value: string) => boolean;
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => isControlCode(character.charCodeAt(0)));
const isControlCode = (code: number): boolean => code <= 31 || isC1ControlCode(code);
const isC1ControlCode = (code: number): boolean => code >= 127 && code <= 159;
const hasPathSeparator = (value: string): boolean => /[\\/]/.test(value);
export const isValidCreatorID: IsValidCreatorID = (value) => {
  const creatorID = value.trim();
  return [
    creatorID.length > 0,
    Array.from(creatorID).length <= 128,
    !hasControlCharacter(value),
    !hasPathSeparator(value),
  ].every(Boolean);
};
type IsNumericFolderID = (id: string) => boolean;
export const isNumericFolderID: IsNumericFolderID = (id) => /^\d+$/.test(id);
type IsRetryableHttpStatus = (status: number) => boolean;
export const isRetryableHttpStatus: IsRetryableHttpStatus = (status) =>
  retryableStatusCodes.has(status) || isServerErrorStatus(status);
const isServerErrorStatus = (status: number): boolean => status >= 500 && status < 600;
const retryableStatusCodes = new Set([408, 429]);
type IsImportOutcomeUnknownStatus = (status: number) => boolean;
export const isImportOutcomeUnknownStatus: IsImportOutcomeUnknownStatus = (status) =>
  isRetryableHttpStatus(status) || isUnrecognizedStatus(status);
const isUnrecognizedStatus = (status: number): boolean => status >= 600;
type IsConfirmationGranted = (confirmed: unknown) => confirmed is true;
export const isConfirmationGranted: IsConfirmationGranted = (confirmed) =>
  confirmed === true;
