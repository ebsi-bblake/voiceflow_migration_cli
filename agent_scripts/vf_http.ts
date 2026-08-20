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

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

export async function requestBytes(
  request: RequestBytesInput,
): Promise<HttpBytes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: controller.signal,
    });
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > request.maxBytes) {
      throw new OperationFault("DEPENDENCY_FAILURE");
    }
    if (!response.body) {
      return {
        status: response.status,
        headers: response.headers,
        bytes: new ArrayBuffer(0),
      };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > request.maxBytes) {
          await reader.cancel();
          throw new OperationFault("DEPENDENCY_FAILURE");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      status: response.status,
      headers: response.headers,
      bytes: bytes.buffer,
    };
  } catch (error) {
    if (error instanceof OperationFault) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OperationFault("DEPENDENCY_TIMEOUT", true);
    }
    throw new OperationFault("DEPENDENCY_FAILURE", true);
  } finally {
    clearTimeout(timer);
  }
}
