import { OperationFault } from "./vf_contracts";
import type { HttpBytes, RequestBytesInput } from "./types";
export { isRetryableHttpStatus } from "./guards";
export type { HttpBytes, RequestBytesInput } from "./types";

type ReadResponseBody = (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
) => Promise<ArrayBuffer>;
type ReadChunks = (reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number) => Promise<readonly Uint8Array[]>;
const readChunks: ReadChunks = (reader, maxBytes) => collectChunks(reader, maxBytes, [], 0);
type CollectChunks = (reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number, chunks: readonly Uint8Array[], size: number) => Promise<readonly Uint8Array[]>;
const collectChunks: CollectChunks = async (reader, maxBytes, chunks, size) => {
  const part = await reader.read();
  if (part.done) return chunks;
  const nextSize = size + part.value.byteLength;
  await rejectOversizedChunk(reader, nextSize, maxBytes);
  return collectChunks(reader, maxBytes, [...chunks, part.value], nextSize);
};
const rejectOversizedChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>, size: number, maxBytes: number,
): Promise<void> => {
  if (size > maxBytes) {
    await reader.cancel();
    throw new OperationFault("DEPENDENCY_FAILURE");
  }
};

type AssembleChunks = (chunks: readonly Uint8Array[], size: number) => ArrayBuffer;
const assembleChunks: AssembleChunks = (chunks, size) => {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
};
const readResponseBody: ReadResponseBody = async (body, maxBytes) => {
  const reader = body.getReader();
  try {
    const chunks = await readChunks(reader, maxBytes);
    return assembleChunks(chunks, chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  } finally {
    reader.releaseLock();
  }
};

type RequestBytes = (request: RequestBytesInput) => Promise<HttpBytes>;
export const requestBytes: RequestBytes = async (request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    return await performRequest(request, controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

const performRequest = async (request: RequestBytesInput, signal: AbortSignal): Promise<HttpBytes> => {
  try {
    const response = await fetch(request.url, { ...request.init, signal });
    validateDeclaredSize(response, request.maxBytes);
    return readHttpBytes(response, request.maxBytes);
  } catch (error) { throw requestFault(error); }
};

const validateDeclaredSize = (response: Response, maxBytes: number): void => {
  const declared = Number(response.headers.get("content-length"));
  if (declaredExceedsLimit(declared, maxBytes)) throw new OperationFault("DEPENDENCY_FAILURE");
};
const readHttpBytes = (response: Response, maxBytes: number): Promise<HttpBytes> =>
  Promise.resolve(response.body === null ? new ArrayBuffer(0) : readResponseBody(response.body, maxBytes))
    .then((bytes) => ({ status: response.status, headers: response.headers, bytes }));

type DeclaredExceedsLimit = (declared: number, maxBytes: number) => boolean;
const declaredExceedsLimit: DeclaredExceedsLimit = (declared, maxBytes) =>
  Number.isFinite(declared) && declared > maxBytes;
type RequestFault = (error: unknown) => OperationFault;
const requestFault: RequestFault = (error) => {
  if (error instanceof OperationFault) return error;
  return nonOperationFault(error);
};
const nonOperationFault = (error: unknown): OperationFault =>
  isAbortError(error) ? new OperationFault("DEPENDENCY_TIMEOUT", true) : new OperationFault("DEPENDENCY_FAILURE", true);
const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";
