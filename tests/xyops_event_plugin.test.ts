import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failure, OperationFault, success, type Envelope } from "../xyops/voiceflow/vf_contracts";
import type { NativePluginJob, OperationHandlers } from "../xyops/plugin/types";
import { validatePluginJob, parsePluginJob, readVoiceflowJWT } from "../xyops/plugin/job_validation";
import { dispatchOperation } from "../xyops/plugin/operation_dispatch";
import { formatPluginDiagnostic } from "../xyops/plugin/diagnostics";
import { runNativePlugin } from "../xyops/plugin/process_entrypoint";
import { mapVoiceflowEnvelope } from "../xyops/plugin/wire_protocol";
import { resolveVoiceflowAuth } from "../xyops/voiceflow/vf_auth";
import { createUUID } from "../xyops/voiceflow/vf_uuid";

type Output = { write: (value: string) => void };
type RestoreGlobalDescriptor = (name: "atob" | "TextDecoder", descriptor: PropertyDescriptor | undefined) => void;
const restoreGlobalDescriptor: RestoreGlobalDescriptor = (name, descriptor) => {
  if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
  else Object.defineProperty(globalThis, name, descriptor);
};

const fakeEnvelope = (operation: string): Promise<Envelope<unknown>> =>
  Promise.resolve(success(operation, `operation-${operation}`, { operation }));

const createFakeHandlers = (calls: string[]): OperationHandlers => ({
  "check-session": (token) => {
    calls.push(`check-session:${token}`);
    return fakeEnvelope("check-session");
  },
  "list-workspaces": (token) => {
    calls.push(`list-workspaces:${token}`);
    return fakeEnvelope("list-workspaces");
  },
  "list-projects": (token, workspaceID) => {
    calls.push(`list-projects:${token}:${workspaceID}`);
    return fakeEnvelope("list-projects");
  },
  "list-versions": (token, workspaceID, projectID) => {
    calls.push(`list-versions:${token}:${workspaceID}:${projectID}`);
    return fakeEnvelope("list-versions");
  },
  "list-folders": (token, workspaceID) => {
    calls.push(`list-folders:${token}:${workspaceID}`);
    return fakeEnvelope("list-folders");
  },
  "plan-migration": (token, workspaceID, projectID, versionID, destinationWorkspaceID, folderID, schema) => {
    calls.push(`plan-migration:${token}:${workspaceID}:${projectID}:${versionID}:${destinationWorkspaceID}:${folderID}:${schema}`);
    return fakeEnvelope("plan-migration");
  },
  "execute-migration": (token, planID, workspaceID, projectID, versionID, destinationWorkspaceID, folderID, schema, confirmed) => {
    calls.push(`execute-migration:${token}:${planID}:${workspaceID}:${projectID}:${versionID}:${destinationWorkspaceID}:${folderID}:${schema}:${confirmed}`);
    return fakeEnvelope("execute-migration");
  },
});

const baseParameters = {
  SOURCE_WORKSPACE_ID: "source-workspace",
  SOURCE_PROJECT_ID: "source-project",
  SOURCE_VERSION_ID: "source-version",
  DESTINATION_WORKSPACE_ID: "destination-workspace",
  DESTINATION_FOLDER_ID: "123",
  TARGET_SCHEMA_VERSION: "13.1",
  PLAN_ID: "plan-1",
  CONFIRMED: true,
} as const;
const removedOperationParameter = ["RUNNER", "NAME"].join("_");

const jobFor = (operation: NativePluginJob["operation"]): NativePluginJob => ({
  operation,
  params: { operation, ...baseParameters },
});

const eventJobFor = (params: Record<string, unknown>): Record<string, unknown> => ({
  xy: 1,
  type: "event",
  params,
});

describe("native XYOps event plugin boundary", () => {
  test("creates RFC 4122 version-four UUIDs without Web Crypto", () => {
    expect(createUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("accepts operation and rejects the removed runner parameter", () => {
    expect(validatePluginJob(eventJobFor({ operation: "check-session" })).operation).toBe("check-session");
    expect(() => validatePluginJob(eventJobFor({ [removedOperationParameter]: "list-workspaces" }))).toThrow("operation parameter");
    expect(validatePluginJob({ ...eventJobFor({ operation: "check-session" }), event: "event-id" }).operation).toBe("check-session");
  });

  test("rejects malformed jobs, accepts unrelated job fields, and hides input", () => {
    expect(() => parsePluginJob("not-json-secret")).toThrow("valid JSON");
    expect(() => validatePluginJob({ params: {} })).toThrow("XYOps event job");
    expect(() => validatePluginJob(eventJobFor({}))).toThrow("operation parameter");
    expect(() => validatePluginJob(eventJobFor({ operation: "delete-everything" }))).toThrow("not supported");
    expect(validatePluginJob({ ...eventJobFor({ operation: "check-session" }), secrets: "masked-secret" }).operation).toBe("check-session");
  });

  test("reads the JWT only from the environment", () => {
    expect(readVoiceflowJWT({ VOICEFLOW_JWT: "environment-token" })).toBe("environment-token");
    expect(() => readVoiceflowJWT({})).toThrow("not configured");
  });

  test("does not allow a top-level secrets field to override the environment", async () => {
    const calls: string[] = [];
    let rendered = "";
    const status = await runNativePlugin(
      (async function* () {
        yield JSON.stringify({
          ...eventJobFor({ operation: "check-session" }),
          secrets: { VOICEFLOW_JWT: "masked-secret" },
        });
      })(),
      { write: (value) => { rendered += value; } },
      { VOICEFLOW_JWT: "environment-token" },
      createFakeHandlers(calls),
    );

    expect(status).toBe(0);
    expect(calls[0]).toBe("check-session:environment-token");
    expect(rendered).not.toContain("masked-secret");
  });

  test.each([
    "check-session",
    "list-workspaces",
    "list-projects",
    "list-versions",
    "list-folders",
    "plan-migration",
    "execute-migration",
  ] as const)("dispatches %s through an injected handler", async (operation) => {
    const calls: string[] = [];
    const result = await dispatchOperation(jobFor(operation), "test-token", createFakeHandlers(calls));
    expect(result.ok).toBe(true);
    expect(calls[0]).toContain(`${operation}:test-token`);
  });

  test("uses a UUID for a dispatch failure fallback", async () => {
    const handlers = createFakeHandlers([]);
    const result = await dispatchOperation(
      jobFor("check-session"),
      "test-token",
      { ...handlers, "check-session": () => Promise.reject(new Error("failure")) },
    );

    expect(result).toMatchObject({ ok: false, operation: "check-session" });
    expect(result.operationID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("requires literal boolean confirmation and does not call execute", async () => {
    const calls: string[] = [];
    const handlers = createFakeHandlers(calls);
    const result = await dispatchOperation(
      { ...jobFor("execute-migration"), params: { ...baseParameters, operation: "execute-migration", CONFIRMED: "true" } },
      "test-token",
      handlers,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "CONFIRMATION_REQUIRED" } });
    expect(calls).toHaveLength(0);
  });

  test("maps Voiceflow success and failure envelopes to protocol responses", () => {
    const successResponse = mapVoiceflowEnvelope(success("check-session", "operation-1", { active: true }));
    expect(successResponse).toMatchObject({ xy: 1, complete: true, code: 0, data: { voiceflow: { ok: true } } });

    const failureResponse = mapVoiceflowEnvelope(failure("check-session", "operation-2", new OperationFault("AUTHENTICATION_FAILED")));
    expect(failureResponse).toMatchObject({ xy: 1, complete: true, code: "AUTHENTICATION_FAILED", description: "[pluginVersion=0.1.7] Authentication failed. (code=AUTHENTICATION_FAILED)" });
    expect(failureResponse.data?.voiceflow).toMatchObject({ ok: false, error: { code: "AUTHENTICATION_FAILED" } });
  });

  test("emits one safe protocol response for malformed input, missing secret, and unknown operation", async () => {
    const cases = [
      { input: "not-json", environment: {} },
      { input: JSON.stringify(eventJobFor({ operation: "check-session" })), environment: {} },
      { input: JSON.stringify(eventJobFor({ operation: "not-supported" })), environment: {} },
    ];
    for (const testCase of cases) {
      let rendered = "";
      const output: Output = { write: (value) => { rendered += value; } };
      const status = await runNativePlugin(
        (async function* () { yield testCase.input; })(),
        output,
        testCase.environment,
      );
      const response: unknown = JSON.parse(rendered);
      expect(status).toBe(0);
      expect(response).toMatchObject({ xy: 1, complete: true });
      expect(rendered).not.toContain("not-supported");
    }
  });

  test("dispatches an operation without the global Web Crypto UUID API", async () => {
    const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto",
    );
    let rendered = "";
    let status: number | undefined;

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    try {
      status = await runNativePlugin(
        (async function* () {
          yield JSON.stringify(eventJobFor({ operation: "check-session" }));
        })(),
        { write: (value) => { rendered += value; } },
        { VOICEFLOW_JWT: "test-token" },
        createFakeHandlers([]),
      );
    } finally {
      if (originalCryptoDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
      }
    }

    expect(status).toBe(0);
    expect(JSON.parse(rendered)).toMatchObject({
      xy: 1,
      complete: true,
      data: { voiceflow: { ok: true, operation: "check-session" } },
    });
  });

  test("decodes JWT claims through the native plugin without Web JWT globals", async () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "native-creator", marker: "¾" }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const token = `header.${payload}.signature`;
    const originalAtobDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "atob",
    );
    const originalTextDecoderDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "TextDecoder",
    );
    let rendered = "";
    const handlers: OperationHandlers = {
      ...createFakeHandlers([]),
      "check-session": (receivedToken) =>
        resolveVoiceflowAuth(receivedToken).then((auth) =>
          success("check-session", "native-auth", auth),
        ),
    };

    try {
      const status = await runNativePlugin(
        (async function* () {
          yield JSON.stringify(eventJobFor({ operation: "check-session" }));
          Object.defineProperty(globalThis, "atob", {
            configurable: true,
            value: undefined,
          });
          Object.defineProperty(globalThis, "TextDecoder", {
            configurable: true,
            value: undefined,
          });
        })(),
        { write: (value) => { rendered += value; } },
        { VOICEFLOW_JWT: `  Bearer ${token}  ` },
        handlers,
      );

      expect(status).toBe(0);
    } finally {
      restoreGlobalDescriptor("atob", originalAtobDescriptor);
      restoreGlobalDescriptor("TextDecoder", originalTextDecoderDescriptor);
    }

    expect(JSON.parse(rendered)).toMatchObject({
      xy: 1,
      complete: true,
      code: 0,
      data: {
        voiceflow: {
          ok: true,
          result: { token, creatorID: "native-creator" },
        },
      },
    });
  });

  test("redacts a secret from unexpected handler failures", async () => {
    const secret = "jwt-secret-must-not-leak";
    const handlers = createFakeHandlers([]);
    const unsafeHandlers: OperationHandlers = {
      ...handlers,
      "check-session": () => Promise.reject(new Error(secret)),
    };
    let rendered = "";
    await runNativePlugin(
      (async function* () { yield JSON.stringify(eventJobFor({ operation: "check-session" })); })(),
      { write: (value) => { rendered += value; } },
      { VOICEFLOW_JWT: secret },
      unsafeHandlers,
    );
    expect(rendered).not.toContain(secret);
    expect(JSON.parse(rendered)).toMatchObject({ code: "INTERNAL_ERROR", data: { voiceflow: { ok: false } } });
  });

  test("reports the response stage and redacts sensitive error details", async () => {
    const secret = "Bearer super-token-secret-value";
    const unsafeHandlers: OperationHandlers = {
      ...createFakeHandlers([]),
      "check-session": () => Promise.resolve(new Proxy({}, {
        get: (_target, property) => {
          if (property === "then") return undefined;
          throw new Error(
            `${secret} params={"SOURCE_PROJECT_ID":"project-secret"} exportBase64=exported-data`,
          );
        },
      }) as Envelope<unknown>),
    };
    let rendered = "";
    let diagnostics = "";
    await runNativePlugin(
      (async function* () { yield JSON.stringify(eventJobFor({ operation: "check-session" })); })(),
      { write: (value) => { rendered += value; } },
      { VOICEFLOW_JWT: "jwt-secret-value" },
      unsafeHandlers,
      { write: (value) => { diagnostics += value; } },
    );

    const response = JSON.parse(rendered) as { description?: string };
    expect(response.description).toContain(diagnostics.trim());
    expect(diagnostics).toMatch(/^pluginVersion=0.1.7 stage=response error=Error message=/);
    expect(diagnostics).not.toContain(secret);
    expect(diagnostics).not.toContain("project-secret");
    expect(diagnostics).not.toContain("exported-data");
    expect(diagnostics).not.toContain("at ");
    expect(diagnostics.length).toBeLessThanOrEqual(321);
  });

  test("formats a bounded diagnostic with an input stage", () => {
    const diagnostic = formatPluginDiagnostic(
      "input",
      new Error(`token-secret ${"x".repeat(500)}\n    at secret-file.ts:1:1`),
    );
    expect(diagnostic).toMatch(/^pluginVersion=0.1.7 stage=input error=Error message=/);
    expect(diagnostic).not.toContain("token-secret");
    expect(diagnostic).not.toContain("secret-file.ts");
    expect(diagnostic.length).toBeLessThanOrEqual(320);
  });

  test("runs a CJS bundle from an extensionless path with Node", () => {
    const directory = mkdtempSync(join(tmpdir(), "voiceflow-plugin-test-"));
    const bundledPath = join(directory, "plugin.cjs");
    const extensionlessPath = join(directory, "plugin");
    const inputPath = join(directory, "input.json");
    const sourcePath = join(import.meta.dir, "../xyops/plugin/entrypoint.ts");
    const input = `${JSON.stringify(eventJobFor({ operation: "check-session" }))}\n`;

    try {
      const build = Bun.spawnSync(
        [
          process.execPath,
          "build",
          sourcePath,
          "--target=node",
          "--format=cjs",
          `--outfile=${bundledPath}`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(build.exitCode).toBe(0);
      copyFileSync(bundledPath, extensionlessPath);
      writeFileSync(inputPath, input);

      const execution = Bun.spawnSync(["node", extensionlessPath], {
        stdin: Bun.file(inputPath),
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = new TextDecoder().decode(execution.stdout).trim();
      const stderr = new TextDecoder().decode(execution.stderr).trim();
      expect(execution.exitCode).toBe(0);
      const response = JSON.parse(output) as { description?: string };
      expect(response).toMatchObject({ xy: 1, complete: true, code: "MISSING_SECRET" });
      expect(response.description).toContain(stderr);
      expect(stderr).toBe(
        "pluginVersion=0.1.7 stage=secret error=PluginValidationFault message=The Voiceflow JWT secret is not configured.",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
