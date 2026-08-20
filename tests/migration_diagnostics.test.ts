import { expect, test } from "bun:test";

import { diagnostic } from "../migration_diagnostics";

test("sanitizes control characters and caps nextAction at 300 characters", () => {
  const error = diagnostic("Import", "unknown", {
    nextAction: "before\u0000after\u007f" + "x".repeat(400),
  });

  expect(error.diagnostic.nextAction).toBe("before after " + "x".repeat(287));
  expect(error.diagnostic.nextAction).toHaveLength(300);
});

test("uses retryability-dependent default actions", () => {
  expect(diagnostic("Export", "timeout").diagnostic.nextAction).toBe(
    "Retry the operation.",
  );
  expect(diagnostic("Catalog", "invalid-input").diagnostic.nextAction).toBe(
    "Check the migration inputs and response.",
  );
});

test("preserves explicit endpoint, retryability, and optional metadata", () => {
  const diagnosticError = diagnostic("Catalog", "server-error", {
    endpoint: "catalog",
    retryable: false,
    status: 503,
    contentType: "application/json",
    responseSize: 42,
    requestId: "request-1",
  });

  expect(diagnosticError.diagnostic).toMatchObject({
    endpoint: "catalog",
    retryable: false,
    status: 503,
    contentType: "application/json",
    responseSize: 42,
    requestId: "request-1",
  });
});

test("does not allow runtime options to override invariants", () => {
  const options = {
    phase: "Export",
    code: "server-error",
    diagnosticId: "caller-id",
    endpoint: "identity",
    retryable: false,
    nextAction: "safe\u0000 action",
  } as any;
  const diagnosticError = diagnostic("Import", "invalid-json", options);

  expect(diagnosticError.diagnostic.phase).toBe("Import");
  expect(diagnosticError.diagnostic.code).toBe("invalid-json");
  expect(diagnosticError.diagnostic.diagnosticId).not.toBe("caller-id");
  expect(diagnosticError.diagnostic.endpoint).toBe("identity");
  expect(diagnosticError.diagnostic.retryable).toBe(false);
  expect(diagnosticError.diagnostic.nextAction).toBe("safe  action");
});
