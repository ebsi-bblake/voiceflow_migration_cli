import { OperationFault } from "./vf_contracts";

export type RequestBytesInput = {
  url: string;
  init?: RequestInit;
  maxBytes: number;
  timeoutMs: number;
};

export type HttpBytes = {
  status: number;
  headers: Headers;
  bytes: ArrayBuffer;
};

const retryableStatusCodes = new Set([408, 429]);

export function isRetryableHttpStatus(status: number): boolean {
  return retryableStatusCodes.has(status) || isServerError(status);
}

function isServerError(status: number): boolean {
  return status >= 500 && status < 600;
}

function declaredSizeExceedsLimit(declared: number, maxBytes: number): boolean {
  return Number.isFinite(declared) && declared > maxBytes;
}

function validateDeclaredSize(response: Response, maxBytes: number): void {
  const declared = Number(response.headers.get("content-length"));
  if (declaredSizeExceedsLimit(declared, maxBytes))
    throw new OperationFault("DEPENDENCY_FAILURE");
}

function emptyBody(): ArrayBuffer {
  return new ArrayBuffer(0);
}

async function readResponseBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const reader = body.getReader();
  try {
    const chunks = await readChunks(reader, maxBytes, [], 0);
    return assembleChunks(chunks);
  } finally {
    reader.releaseLock();
  }
}

async function appendChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  chunks: readonly Uint8Array[],
  size: number,
  chunk: Uint8Array,
): Promise<readonly Uint8Array[]> {
  const nextSize = size + chunk.byteLength;
  if (nextSize > maxBytes) {
    await reader.cancel();
    throw new OperationFault("DEPENDENCY_FAILURE");
  }
  return readChunks(reader, maxBytes, [...chunks, chunk], nextSize);
}

async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  chunks: readonly Uint8Array[],
  size: number,
): Promise<readonly Uint8Array[]> {
  const part = await reader.read();
  return part.done
    ? chunks
    : appendChunk(reader, maxBytes, chunks, size, part.value);
}

function assembleChunks(chunks: readonly Uint8Array[]): ArrayBuffer {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return bytes.buffer;
}

async function performRequest(
  request: RequestBytesInput,
  signal: AbortSignal,
): Promise<HttpBytes> {
  const response = await fetch(request.url, {
    ...request.init,
    signal,
  });
  validateDeclaredSize(response, request.maxBytes);
  const bytes = response.body
    ? await readResponseBody(response.body, request.maxBytes)
    : emptyBody();
  return { status: response.status, headers: response.headers, bytes };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function dependencyFault(isTimeout: boolean): OperationFault {
  return isTimeout
    ? new OperationFault("DEPENDENCY_TIMEOUT", true)
    : new OperationFault("DEPENDENCY_FAILURE", true);
}

function toRequestFault(error: unknown): OperationFault {
  if (error instanceof OperationFault) return error;
  return dependencyFault(isAbortError(error));
}

export function requestBytes(request: RequestBytesInput): Promise<HttpBytes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  return performRequest(request, controller.signal)
    .catch((error) => Promise.reject(toRequestFault(error)))
    .finally(() => clearTimeout(timer));
}
