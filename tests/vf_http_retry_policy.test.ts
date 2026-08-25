import { expect, test } from "bun:test";

import { exportVersion } from "../xyops/voiceflow/vf_export";

const TOKEN = "aaa.eyJzdWIiOiJjcmVhdG9yIn0.zzz";
const AUTH = { token: TOKEN, creatorID: "creator" };
const originalFetch = globalThis.fetch;
const scenarioEnvironmentVariable = "VF_HTTP_RETRY_POLICY_SCENARIO";

function installStatusResponse(status: number): void {
  globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
}

function expectedRetryability(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function runCheckSessionScenario(status: number): unknown {
  installStatusResponse(status);
  return import("../xyops/voiceflow/vf_check_session").then(({ main }) => main(TOKEN));
}

function runIsolatedCheckSession(status: number): unknown {
  const child = Bun.spawnSync([process.execPath, "run", import.meta.path], {
    env: {
      ...process.env,
      [scenarioEnvironmentVariable]: String(status),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = new TextDecoder().decode(child.stderr).trim();
  const stdout = new TextDecoder().decode(child.stdout).trim();
  if (child.exitCode !== 0) {
    throw new Error(`Isolated check-session failed with exit ${child.exitCode}: ${stderr}`);
  }
  return JSON.parse(stdout) as unknown;
}

const requestedScenario = process.env[scenarioEnvironmentVariable];

if (requestedScenario !== undefined) {
  const status = Number(requestedScenario);
  if (!Number.isInteger(status)) throw new Error("Invalid retry policy scenario");
  const envelope = await runCheckSessionScenario(status);
  process.stdout.write(JSON.stringify(envelope));
} else {
  for (const status of [400, 404, 408, 429, 500, 503]) {
    test(`check-session classifies HTTP ${status}`, () => {
      expect(runIsolatedCheckSession(status)).toMatchObject({
        ok: false,
        error: {
          code: "DEPENDENCY_FAILURE",
          message: "The Voiceflow dependency failed.",
          retryable: expectedRetryability(status),
        },
      });
    });

    test(`exportVersion classifies HTTP ${status}`, async () => {
      installStatusResponse(status);
      try {
        await expect(exportVersion(AUTH, "version")).rejects.toMatchObject({
          code: "DEPENDENCY_FAILURE",
          message: "The Voiceflow dependency failed.",
          retryable: expectedRetryability(status),
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  for (const status of [401, 403]) {
    test(`check-session treats HTTP ${status} as login required`, () => {
      expect(runIsolatedCheckSession(status)).toMatchObject({
        ok: true,
        result: {
          active: false,
          loginRequired: true,
          loginUrl: "https://creator.empyrean.voiceflow.com/",
        },
      });
    });
  }
}
