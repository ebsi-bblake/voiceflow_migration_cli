import { describe, expect, test } from "bun:test";
import { createXYOpsClient } from "../xyops/cli/client";
import { DEFAULT_XYOPS_BASE_URL, readXYOpsConfig } from "../xyops/cli/config";
import { isOptionResult, isVoiceflowEnvelope } from "../xyops/cli/contracts";
import { run } from "../migration-cli";
import {
  executeParameters,
  listFoldersParameters,
  listProjectsParameters,
  listVersionsParameters,
  listWorkspacesParameters,
  planParameters,
} from "../xyops/cli/state";

const config = {
  baseURL: "https://xyops.example.test",
  apiKey: "api-key-must-not-leak",
  events: {
    checkSession: "event-check",
    listWorkspaces: "event-workspaces",
    listProjects: "event-projects",
    listVersions: "event-versions",
    listFolders: "event-folders",
    planMigration: "event-plan",
    executeMigration: "event-execute",
  },
  httpTimeoutMs: 1_000,
  pollIntervalMs: 1,
  pollTimeoutMs: 1_000,
} as const;

const selection = {
  sourceWorkspaceID: "source-workspace",
  sourceProjectID: "source-project",
  sourceVersionID: "source-version",
  destinationWorkspaceID: "destination-workspace",
  destinationFolderID: "destination-folder",
  targetSchemaVersion: "13.1",
} as const;

describe("XYOps CLI adapter", () => {
  test("sends a title-based event request without a JWT and unwraps a read-only envelope", async () => {
    const requests: Array<{ url: string; body: string; headers: Headers }> = [];
    const client = createXYOpsClient(config, {
      fetcher: async (input, init) => {
        requests.push({
          url: String(input),
          body: String(init?.body),
          headers: new Headers(init?.headers),
        });
        return new Response(
          JSON.stringify({
            code: 0,
            job: {
              id: "job-1",
              code: 0,
              completed: 1787683968.928,
              output: `${JSON.stringify({
                ok: true,
                operation: "list-projects",
                operationID: "operation-1",
                result: { options: [{ value: "project-1", label: "Project 1" }] },
                warnings: [],
              })}\n`,
              data: null,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await client.readEvent(
      "event-projects",
      { RUNNER_NAME: "list-projects", SOURCE_WORKSPACE_ID: "workspace-1" },
      isVoiceflowEnvelope(isOptionResult),
    );

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe("https://xyops.example.test/api/app/run_event/v1/wait");
    expect(requests[0]?.headers.get("X-API-Key")).toBe("api-key-must-not-leak");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      title: "event-projects",
      params: { RUNNER_NAME: "list-projects", SOURCE_WORKSPACE_ID: "workspace-1" },
    });
    expect(requests[0]?.body).not.toContain("VOICEFLOW_JWT");
    expect(requests[0]?.body).not.toContain("api-key-must-not-leak");
  });

  test("requires only the API key and supplies local event-title defaults", () => {
    const config = readXYOpsConfig({ XYOPS_API_KEY: "local-api-key" });

    expect(config.baseURL).toBe(DEFAULT_XYOPS_BASE_URL);
    expect(config.events).toEqual({
      checkSession: { title: "voiceflow_check_session" },
      listWorkspaces: { title: "voiceflow_list_workspaces" },
      listProjects: { title: "voiceflow_list_projects" },
      listVersions: { title: "voiceflow_list_versions" },
      listFolders: { title: "voiceflow_list_folders" },
      planMigration: { title: "voiceflow_plan_migration" },
      executeMigration: { title: "voiceflow_execute_migration" },
    });
  });

  test("keeps the API key required", () => {
    expect(() => readXYOpsConfig({})).toThrow();
  });

  test("supports URL, title, and explicit ID event overrides", () => {
    const config = readXYOpsConfig({
      XYOPS_API_KEY: "local-api-key",
      XYOPS_BASE_URL: "https://xyops.example.test/",
      XYOPS_EVENT_CHECK_SESSION: "id:event-check",
      XYOPS_EVENT_LIST_PROJECTS: "title:custom-projects",
    });

    expect(config.baseURL).toBe("https://xyops.example.test");
    expect(config.events.checkSession).toEqual({ id: "event-check" });
    expect(config.events.listProjects).toEqual({ title: "custom-projects" });
  });

  test("uses an explicit ID reference in the XYOps request body", async () => {
    const requests: string[] = [];
    const client = createXYOpsClient(config, {
      fetcher: async (_input, init) => {
        requests.push(String(init?.body));
        return new Response(
          JSON.stringify({
            code: 0,
            job: {
              id: "job-1",
              code: 0,
              completed: true,
              data: {
                ok: true,
                operation: "check-session",
                operationID: "operation-1",
                result: { options: [{ value: "workspace-1", label: "Workspace 1" }] },
                warnings: [],
              },
            },
          }),
          { status: 200 },
        );
      },
    });

    await client.readEvent(
      { id: "event-check" },
      { RUNNER_NAME: "check-session" },
      isVoiceflowEnvelope(isOptionResult),
    );

    expect(JSON.parse(requests[0] ?? "{}")).toMatchObject({ id: "event-check" });
    expect(JSON.parse(requests[0] ?? "{}")).not.toHaveProperty("title");
  });

  test("falls back to job data when output is empty", async () => {
    const client = createXYOpsClient(config, {
      fetcher: async () => new Response(
        JSON.stringify({
          code: 0,
          job: {
            id: "job-1",
            code: 0,
            completed: true,
            output: "  ",
            data: {
              ok: true,
              operation: "list-projects",
              operationID: "operation-1",
              result: { options: [{ value: "project-1", label: "Project 1" }] },
              warnings: [],
            },
          },
        }),
        { status: 200 },
      ),
    });

    const result = await client.readEvent(
      "event-projects",
      { RUNNER_NAME: "list-projects" },
      isVoiceflowEnvelope(isOptionResult),
    );

    expect(result.ok).toBe(true);
  });

  test("rejects malformed job output without exposing the raw output", async () => {
    const rawOutput = "not-json-secret-output";
    const client = createXYOpsClient(config, {
      fetcher: async () => new Response(
        JSON.stringify({
          code: 0,
          job: { id: "job-1", code: 0, completed: true, output: rawOutput, data: null },
        }),
        { status: 200 },
      ),
    });

    const error = await client.readEvent(
      "event-projects",
      { RUNNER_NAME: "list-projects" },
      isVoiceflowEnvelope(isOptionResult),
    ).catch((value: unknown) => value);

    expect(error).toMatchObject({
      diagnostic: {
        code: "job",
        nextAction: "XYOps returned malformed job output.",
      },
    });
    expect(String(error)).not.toContain(rawOutput);
  });

  test("checks for an active session before requesting workspace choices", async () => {
    const environmentNames = [
      "XYOPS_API_KEY",
      "XYOPS_BASE_URL",
      "XYOPS_EVENT_CHECK_SESSION",
      "XYOPS_EVENT_LIST_WORKSPACES",
    ];
    const previousEnvironment = Object.fromEntries(
      environmentNames.map((name) => [name, process.env[name]]),
    );
    const previousFetch = globalThis.fetch;
    const previousLog = console.log;
    const requests: string[] = [];
    const output: string[] = [];
    process.env.XYOPS_API_KEY = "local-api-key";
    delete process.env.XYOPS_BASE_URL;
    delete process.env.XYOPS_EVENT_CHECK_SESSION;
    delete process.env.XYOPS_EVENT_LIST_WORKSPACES;
    globalThis.fetch = async (_input, init) => {
      requests.push(String(init?.body));
      return new Response(
        JSON.stringify({
          code: 0,
          job: {
            id: "job-1",
            code: 0,
            data: {
              ok: true,
              operation: "check-session",
              operationID: "operation-1",
              result: { active: false },
              warnings: [],
            },
          },
        }),
        { status: 200 },
      );
    };
    console.log = (...values: unknown[]) => output.push(values.join(" "));

    try {
      await expect(run()).rejects.toThrow();
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0] ?? "{}")).toMatchObject({ title: "voiceflow_check_session" });
      expect(output.some((line) => line.includes("Source workspace"))).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      console.log = previousLog;
      for (const name of environmentNames) {
        const value = previousEnvironment[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("uses a top-level launch ID and polls get_job exactly once per dispatch", async () => {
    const requests: Array<{ path: string; body: string }> = [];
    const client = createXYOpsClient(config, {
      fetcher: async (input, init) => {
        const path = new URL(String(input)).pathname;
        requests.push({ path, body: String(init?.body) });
        if (path === "/api/app/run_event/v1") {
          return new Response(JSON.stringify({ code: 0, id: "official-job-id" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            code: 0,
            job: {
              id: "official-job-id",
              completed: 1787683968.928,
              code: 0,
              output: `${JSON.stringify({ ok: true, operation: "execute-migration", operationID: "operation-3", result: {}, warnings: [] })}\n`,
              data: null,
            },
          }),
          { status: 200 },
        );
      },
      sleeper: async () => undefined,
    });

    const result = await client.executeEvent(
      "event-execute",
      executeParameters(selection, "plan-1"),
      isVoiceflowEnvelope((value): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null),
    );

    expect(result).toEqual({
      ok: true,
      operation: "execute-migration",
      operationID: "operation-3",
      result: {},
      warnings: [],
    });
    expect(requests.map(({ path }) => path)).toEqual([
      "/api/app/run_event/v1",
      "/api/app/get_job/v1",
    ]);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({ id: "official-job-id" });
    expect(requests.filter(({ path }) => path === "/api/app/run_event/v1")).toHaveLength(1);
  });

  test("reports an unknown execute outcome without redispatching when launch ID is absent", async () => {
    let dispatchCount = 0;
    const client = createXYOpsClient(config, {
      fetcher: async (input) => {
        if (new URL(String(input)).pathname === "/api/app/run_event/v1") dispatchCount += 1;
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      },
    });

    await expect(client.executeEvent(
      "event-execute",
      executeParameters(selection, "plan-1"),
      isVoiceflowEnvelope((value): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null),
    )).rejects.toMatchObject({
      diagnostic: { code: "execute-outcome-unknown" },
    });
    expect(dispatchCount).toBe(1);
  });

  test("dispatches execute once and polls get_job until completion", async () => {
    const paths: string[] = [];
    let pollCount = 0;
    const client = createXYOpsClient(config, {
      fetcher: async (input) => {
        const url = String(input);
        paths.push(new URL(url).pathname);
        if (url.endsWith("/run_event/v1")) {
          return new Response(JSON.stringify({ code: 200, description: "OK", data: { id: "job-1" } }), { status: 200 });
        }
        pollCount += 1;
        return new Response(
          JSON.stringify({
            code: 200,
            description: "OK",
            data: pollCount === 1
              ? { id: "job-1", completed: false, code: 0, data: null }
              : {
                  id: "job-1",
                  completed: 1787683968.928,
                  code: 0,
                  output: `${JSON.stringify({
                    ok: true,
                    operation: "execute-migration",
                    operationID: "operation-2",
                    result: {
                      planID: "plan-1",
                      exportStatus: 200,
                      exportBytes: 10,
                      importStatus: 200,
                      importBytes: 20,
                      selected: {
                        sourceWorkspaceID: "source-workspace",
                        sourceProjectID: "source-project",
                        sourceVersionID: "source-version",
                        destinationWorkspaceID: "destination-workspace",
                        destinationFolderID: "destination-folder",
                        targetSchemaVersion: "13.1",
                      },
                      imported: { projectID: "imported-project" },
                      apiKeyRetrieved: true,
                    },
                    warnings: [],
                  })}\n`,
                  data: null,
                },
          }),
          { status: 200 },
        );
      },
      sleeper: async () => undefined,
    });

    const result = await client.executeEvent(
      "event-execute",
      executeParameters(selection, "plan-1"),
      isVoiceflowEnvelope((value): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null),
    );

    expect(result.ok).toBe(true);
    expect(paths).toEqual(["/api/app/run_event/v1", "/api/app/get_job/v1", "/api/app/get_job/v1"]);
    expect(paths.filter((path) => path === "/api/app/run_event/v1")).toHaveLength(1);
  });

  test("uses the shared runner names and exact migration parameter keys", () => {
    expect(listWorkspacesParameters()).toEqual({ RUNNER_NAME: "list-workspaces" });
    expect(listProjectsParameters("source-workspace")).toEqual({
      RUNNER_NAME: "list-projects",
      SOURCE_WORKSPACE_ID: "source-workspace",
    });
    expect(listVersionsParameters("source-workspace", "source-project")).toEqual({
      RUNNER_NAME: "list-versions",
      SOURCE_WORKSPACE_ID: "source-workspace",
      SOURCE_PROJECT_ID: "source-project",
    });
    expect(listFoldersParameters("destination-workspace")).toEqual({
      RUNNER_NAME: "list-folders",
      DESTINATION_WORKSPACE_ID: "destination-workspace",
    });
    expect(planParameters(selection)).toEqual({
      RUNNER_NAME: "plan-migration",
      SOURCE_WORKSPACE_ID: "source-workspace",
      SOURCE_PROJECT_ID: "source-project",
      SOURCE_VERSION_ID: "source-version",
      DESTINATION_WORKSPACE_ID: "destination-workspace",
      DESTINATION_FOLDER_ID: "destination-folder",
      TARGET_SCHEMA_VERSION: "13.1",
    });
    expect(executeParameters(selection, "plan-1")).toMatchObject({
      RUNNER_NAME: "execute-migration",
      PLAN_ID: "plan-1",
      CONFIRMED: "true",
    });
  });
});
