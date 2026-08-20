import { describe, expect, test } from "bun:test";
import type { AuthContext } from "../agent_scripts/vf_auth";
import {
  retrieveApiKeyStatus,
  type ApiKeyStatus,
} from "../agent_scripts/vf_api_key";
import { main as oneFileMain } from "../migration_correct";

const auth: AuthContext = {
  creatorID: "creator",
  token: "token",
};

const agentMissingProjectOutcome = {
  apiKeyRetrieved: false,
  postImport: {
    apiKeyRetrieved: false,
    diagnostic: {
      code: "PROJECT_ID_UNAVAILABLE",
      message: "Imported project ID was unavailable.",
    },
  },
} satisfies ApiKeyStatus;

const agentRetrievalFailureOutcome = {
  apiKeyRetrieved: false,
  postImport: {
    apiKeyRetrieved: false,
    diagnostic: {
      code: "API_KEY_RETRIEVAL_FAILED",
      message: "Project API key could not be retrieved.",
    },
  },
} satisfies ApiKeyStatus;

const oneFileMissingProjectOutcome = {
  apiKeyRetrieved: false,
  postImport: {
    apiKeyRetrieved: false,
    diagnostic: {
      code: "project-id-unavailable",
      message: "Import succeeded, but the imported project ID was unavailable.",
    },
  },
} as const;

const oneFileRetrievalFailureOutcome = {
  apiKeyRetrieved: false,
  postImport: {
    apiKeyRetrieved: false,
    diagnostic: {
      code: "api-key-retrieval-failed",
      message: "Import succeeded, but the project API key could not be retrieved.",
    },
  },
} as const;

const oneFileArguments = [
  "aaa.eyJzdWIiOiJjcmVhdG9yIn0.zzz",
  "source-workspace",
  "source-project",
  "source-version",
  "destination-workspace",
  "1",
] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function sequentialFetch(responses: readonly Response[]): typeof fetch {
  const pendingResponses = [...responses];

  return (async () => {
    const response = pendingResponses.shift();
    if (!response) throw new Error("Unexpected fetch after response sequence ended");
    return response;
  }) as typeof fetch;
}

async function withMockedFetch<T>(
  replacement: typeof fetch,
  action: () => Promise<T>,
): Promise<T> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = replacement;

  try {
    return await action();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function relevantOneFileApiKeyOutcome(
  result: Awaited<ReturnType<typeof oneFileMain>>,
) {
  return {
    apiKeyRetrieved: result.apiKeyRetrieved,
    postImport: result.postImport,
  };
}

describe("agent API-key outcome", () => {
  test("reports the exact missing-project failure without fetching", async () => {
    let fetchCalls = 0;
    const unexpectedFetch = (async () => {
      fetchCalls += 1;
      throw new Error("Unexpected fetch without an imported project ID");
    }) as typeof fetch;

    const result = await withMockedFetch(unexpectedFetch, () =>
      retrieveApiKeyStatus(auth),
    );

    expect(result).toEqual(agentMissingProjectOutcome);
    expect(fetchCalls).toBe(0);
  });

  test("reports the exact retrieval failure for a malformed payload", async () => {
    const result = await withMockedFetch(
      sequentialFetch([new Response("not json")]),
      () => retrieveApiKeyStatus(auth, "imported-project"),
    );

    expect(result).toEqual(agentRetrievalFailureOutcome);
  });

  test("reports the exact retrieval failure for an HTTP dependency failure", async () => {
    const leakedApiKey = "VF.DM.http-failure-secret";
    const dependencyFailure = jsonResponse({ apiKey: leakedApiKey }, 500);

    const result = await withMockedFetch(
      sequentialFetch([dependencyFailure]),
      () => retrieveApiKeyStatus(auth, "imported-project"),
    );

    expect(result).toEqual(agentRetrievalFailureOutcome);
    expect(JSON.stringify(result)).not.toContain(leakedApiKey);
  });

  test("reports the exact retrieval failure for ambiguous distinct keys", async () => {
    const ambiguousPayload = {
      apiKey: "VF.DM.first-secret",
      key: "VF.DM.second-secret",
    };

    const result = await withMockedFetch(
      sequentialFetch([jsonResponse(ambiguousPayload)]),
      () => retrieveApiKeyStatus(auth, "imported-project"),
    );

    expect(result).toEqual(agentRetrievalFailureOutcome);
    expect(JSON.stringify(result)).not.toContain(ambiguousPayload.apiKey);
    expect(JSON.stringify(result)).not.toContain(ambiguousPayload.key);
  });

  test("reports success without postImport or API-key leakage", async () => {
    const retrievedApiKey = "VF.DM.success-secret";

    const result = await withMockedFetch(
      sequentialFetch([jsonResponse({ apiKey: retrievedApiKey })]),
      () => retrieveApiKeyStatus(auth, "imported-project"),
    );

    expect(result).toEqual({ apiKeyRetrieved: true });
    expect(result).not.toHaveProperty("postImport");
    expect(JSON.stringify(result)).not.toContain(retrievedApiKey);
  });
});

describe("one-file API-key outcome", () => {
  test("omits postImport and the retrieved key on success", async () => {
    const exportedBytes = new TextEncoder().encode("export");
    const retrievedApiKey = "VF.DM.one-file-success-secret";
    const responses = [
      new Response(exportedBytes),
      jsonResponse({ projectID: "new-project" }),
      jsonResponse({ apiKey: retrievedApiKey }),
    ];

    const result = await withMockedFetch(sequentialFetch(responses), () =>
      oneFileMain(...oneFileArguments),
    );

    expect(result.apiKeyRetrieved).toBe(true);
    expect(result).not.toHaveProperty("postImport");
    expect(JSON.stringify(result)).not.toContain(retrievedApiKey);
  });

  test("returns the exact project-id-unavailable diagnostic", async () => {
    const exportedBytes = new TextEncoder().encode("export");
    const responses = [
      new Response(exportedBytes),
      jsonResponse({ imported: true }),
    ];

    const result = await withMockedFetch(sequentialFetch(responses), () =>
      oneFileMain(...oneFileArguments),
    );

    expect(relevantOneFileApiKeyOutcome(result)).toEqual(
      oneFileMissingProjectOutcome,
    );
    expect(JSON.stringify(result)).not.toContain("VF.DM.");
  });

  test("returns the exact api-key-retrieval-failed diagnostic without leaking the key", async () => {
    const exportedBytes = new TextEncoder().encode("export");
    const retrievedApiKey = "VF.DM.one-file-failure-secret";
    const responses = [
      new Response(exportedBytes),
      jsonResponse({ projectID: "new-project" }),
      jsonResponse({ apiKey: retrievedApiKey }, 500),
    ];

    const result = await withMockedFetch(sequentialFetch(responses), () =>
      oneFileMain(...oneFileArguments),
    );

    expect(relevantOneFileApiKeyOutcome(result)).toEqual(
      oneFileRetrievalFailureOutcome,
    );
    expect(JSON.stringify(result)).not.toContain(retrievedApiKey);
  });
});
