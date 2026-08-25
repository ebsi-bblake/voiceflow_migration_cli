import { describe, expect, test } from "bun:test";

import { importFile } from "../import_project_api";
import {
  MigrationError,
  type MigrationDiagnostic,
} from "../migration_diagnostics";
import type { AuthContext } from "../jwt_authentication_context";
import type { ExportArtifact, ImportReceipt } from "../shared_contract_types";

type StableMigrationDiagnostic = Omit<MigrationDiagnostic, "diagnosticId">;

const auth: AuthContext = {
  token: "controlled-token",
  creatorID: "controlled-creator",
};
const artifact: ExportArtifact = {
  bytes: new Uint8Array([1, 2, 3]).buffer,
  filename: "controlled-export.vf",
  contentType: "application/octet-stream",
  status: 200,
};
const request = {
  artifact,
  destinationWorkspaceID: "destination-workspace",
  folderID: "42",
  targetSchemaVersion: "13.1",
} as const;
const expectedReceipt: ImportReceipt = {
  projectID: "imported-project",
  devVersion: "development-version",
  liveVersion: "live-version",
  assistantID: "assistant-id",
  folderID: request.folderID,
  workspaceID: request.destinationWorkspaceID,
  sourceProjectID: "source-project",
};
const expectedInvalidReceiptDiagnostic: StableMigrationDiagnostic = {
  phase: "Import",
  endpoint: "unknown",
  code: "invalid-import-receipt",
  retryable: false,
  nextAction: "Check the migration inputs and response.",
  status: 201,
};

type ControlledFetch = {
  calls: Array<{ input: RequestInfo | URL; init?: RequestInit }>;
};

function installImportResponse(value: unknown): ControlledFetch {
  const calls: ControlledFetch["calls"] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(value), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

async function withImportResponse<T>(
  value: unknown,
  operation: (controlledFetch: ControlledFetch) => Promise<T>,
): Promise<T> {
  const previousFetch = globalThis.fetch;
  const controlledFetch = installImportResponse(value);
  try {
    return await operation(controlledFetch);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function captureInvalidReceiptDiagnostic(
  value: unknown,
): Promise<StableMigrationDiagnostic> {
  return withImportResponse(value, async (controlledFetch) => {
    const error = await importFile(auth, request).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(controlledFetch.calls).toHaveLength(1);
    expect(error).toBeInstanceOf(MigrationError);
    const { diagnosticId, ...stableDiagnostic } = (error as MigrationError)
      .diagnostic;
    expect(diagnosticId).not.toBe("");
    return stableDiagnostic;
  });
}

async function captureInvalidReceiptDiagnostics(
  values: readonly unknown[],
): Promise<StableMigrationDiagnostic[]> {
  const diagnostics: StableMigrationDiagnostic[] = [];
  for (const value of values) {
    diagnostics.push(await captureInvalidReceiptDiagnostic(value));
  }
  return diagnostics;
}

describe("root import contract", () => {
  test("rejects array and non-record JSON roots with the same invalid-receipt diagnostic", async () => {
    const invalidRoots: readonly unknown[] = [
      [],
      [{ project: { _id: "must-not-be-read-from-an-array" } }],
      null,
      "receipt",
      42,
      true,
    ];

    const fetchBeforeCases = globalThis.fetch;
    const diagnostics = await captureInvalidReceiptDiagnostics(invalidRoots);

    expect(diagnostics).toEqual(
      invalidRoots.map(() => expectedInvalidReceiptDiagnostic),
    );
    expect(globalThis.fetch).toBe(fetchBeforeCases);
  });

  test("returns a valid import receipt unchanged", async () => {
    const fetchBeforeCase = globalThis.fetch;
    await withImportResponse(
      {
        project: {
          _id: expectedReceipt.projectID,
          devVersion: expectedReceipt.devVersion,
          liveVersion: expectedReceipt.liveVersion,
        },
        assistant: {
          id: expectedReceipt.assistantID,
          folderID: expectedReceipt.folderID,
          workspaceID: expectedReceipt.workspaceID,
        },
        sourceProjectID: expectedReceipt.sourceProjectID,
      },
      async (controlledFetch) => {
        await expect(importFile(auth, request)).resolves.toEqual({
          status: 201,
          receipt: expectedReceipt,
        });
        expect(controlledFetch.calls).toHaveLength(1);
        expect(String(controlledFetch.calls[0]?.input)).toBe(
          "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/import-file/destination-workspace",
        );
        expect(controlledFetch.calls[0]?.init?.method).toBe("POST");
      },
    );
    expect(globalThis.fetch).toBe(fetchBeforeCase);
  });
});
