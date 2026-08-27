export type RecordValue = Readonly<Record<string, unknown>>;
type IsRecord = (value: unknown) => value is RecordValue;
export const isRecord: IsRecord = (value): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
export const isValidCreatorID: IsValidCreatorID = (value) => {
  const creatorID = value.trim();
  return (
    creatorID.length > 0 &&
    Array.from(creatorID).length <= 128 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value) &&
    !/[\\/]/.test(value)
  );
};
type IsNumericFolderID = (id: string) => boolean;
export const isNumericFolderID: IsNumericFolderID = (id) => /^\d+$/.test(id);
type IsRetryableHttpStatus = (status: number) => boolean;
export const isRetryableHttpStatus: IsRetryableHttpStatus = (status) =>
  status === 408 || status === 429 || (status >= 500 && status < 600);
type IsImportOutcomeUnknownStatus = (status: number) => boolean;
export const isImportOutcomeUnknownStatus: IsImportOutcomeUnknownStatus = (status) =>
  isRetryableHttpStatus(status) || status >= 600;
type IsConfirmationGranted = (confirmed: unknown) => confirmed is true;
export const isConfirmationGranted: IsConfirmationGranted = (confirmed) =>
  confirmed === true;
