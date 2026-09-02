import { describe, expect, test } from "bun:test";
import { toOperationError } from "../xyops/voiceflow/vf_contracts";

describe("Voiceflow unexpected error diagnostics", () => {
  test("returns a bounded safe error message", () => {
    const result = toOperationError(new Error(
      "WebSocket connection failed for Bearer abc VF.DM.xyz-value https://user:pass@example.test/path",
    ));

    expect(result).toMatchObject({ code: "INTERNAL_ERROR", retryable: false });
    expect(result.message).toContain("WebSocket connection failed");
    expect(result.message).toContain("Bearer [redacted]");
    expect(result.message).toContain("VF.DM.[redacted]");
    expect(result.message).toContain("[redacted-url]");
    expect(result.message).not.toContain("abc");
    expect(result.message).not.toContain("xyz-value");
  });
});
