import { describe, expect, test } from "bun:test";

import type { AuthContext } from "../agent_scripts/vf_auth";
import {
  retrieveApiKeyStatus,
  type ApiKeyStatus,
} from "../agent_scripts/vf_api_key";

const auth: AuthContext = {
  creatorID: "creator",
  token: "header.payload.signature",
};

const successfulStatus = {
  apiKeyRetrieved: true,
} satisfies ApiKeyStatus;

const failedStatus = {
  apiKeyRetrieved: false,
  postImport: {
    apiKeyRetrieved: false,
    diagnostic: {
      code: "API_KEY_RETRIEVAL_FAILED",
      message: "Project API key could not be retrieved.",
    },
  },
} satisfies ApiKeyStatus;

type FetchObservation = {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
};

type ApiKeyCall = {
  readonly status: ApiKeyStatus;
  readonly requests: readonly FetchObservation[];
};

function requestURL(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function retrieveWithControlledFetch(
  body: string,
  projectID = " imported-project ",
): Promise<ApiKeyCall> {
  const previousFetch = globalThis.fetch;
  const requests: FetchObservation[] = [];
  globalThis.fetch = (async (input, init) => {
    if (requests.length > 0) throw new Error("Unexpected repeated API-key request");
    requests.push({
      url: requestURL(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  try {
    const status = await retrieveApiKeyStatus(auth, projectID);
    return { status, requests };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function expectSanitizedStatus(
  status: ApiKeyStatus,
  keys: readonly string[],
): void {
  const publicStatus = JSON.stringify(status);
  for (const key of keys) expect(publicStatus).not.toContain(key);
  expect(publicStatus).not.toContain("VF.DM.");
}

describe("Voiceflow API-key policy", () => {
  test("normalizes key and project-ID whitespace without leaking the key", async () => {
    const key = "VF.DM.whitespace-secret";
    const previousFetch = globalThis.fetch;

    const { status, requests } = await retrieveWithControlledFetch(
      ` \n\t${key}  \r\n`,
    );

    expect(status).toEqual(successfulStatus);
    expect(requests).toEqual([
      {
        url: "https://identity-api.empyrean.voiceflow.com/v1alpha1/api-key/legacy/project/imported-project",
        method: "POST",
        authorization: `Bearer ${auth.token}`,
      },
    ]);
    expectSanitizedStatus(status, [key]);
    expect(globalThis.fetch).toBe(previousFetch);
  });

  test("rejects a key with an invalid prefix and returns a sanitized status", async () => {
    const key = "VF.XM.invalid-prefix-secret";

    const { status } = await retrieveWithControlledFetch(key);

    expect(status).toEqual(failedStatus);
    expectSanitizedStatus(status, [key]);
  });

  test("accepts duplicate aliases containing the same normalized key", async () => {
    const key = "VF.DM.duplicate-secret";
    const body = JSON.stringify({
      apiKey: ` ${key} `,
      api_key: key,
      key: `\n${key}\t`,
      token: key,
    });

    const { status } = await retrieveWithControlledFetch(body);

    expect(status).toEqual(successfulStatus);
    expectSanitizedStatus(status, [key]);
  });

  test("rejects multiple distinct valid keys without exposing either key", async () => {
    const firstKey = "VF.DM.first-secret";
    const secondKey = "VF.DM.second-secret";
    const body = JSON.stringify({ apiKey: firstKey, token: secondKey });

    const { status } = await retrieveWithControlledFetch(body);

    expect(status).toEqual(failedStatus);
    expectSanitizedStatus(status, [firstKey, secondKey]);
  });
});
