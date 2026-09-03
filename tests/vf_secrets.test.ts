import { describe, expect, test } from "bun:test";
import {
  parseSecretEntries,
  parseSecretEntriesJSON,
  parseSecretsFile,
} from "../xyops/voiceflow/vf_secrets";

describe("secret file parsing", () => {
  test("accepts JSON name/value entries", () => {
    const contents = JSON.stringify([
      { name: "FIRST_SECRET", value: "first value" },
      { name: "SECOND_SECRET", value: "second value" },
    ]);

    expect(parseSecretsFile(contents)).toEqual([
      { name: "FIRST_SECRET", value: "first value" },
      { name: "SECOND_SECRET", value: "second value" },
    ]);
  });

  test("accepts parsed JSON arrays", () => {
    expect(
      parseSecretEntries([{ name: "TEST_SECRET", value: "value" }]),
    ).toEqual([{ name: "TEST_SECRET", value: "value" }]);
    expect(parseSecretEntriesJSON('[{"name":"TEST_SECRET","value":"value"}]'))
      .toEqual([{ name: "TEST_SECRET", value: "value" }]);
  });

  test("rejects the legacy object map format", () => {
    expect(() => parseSecretEntries({ TEST_SECRET: "value" })).toThrow(
      "JSON array",
    );
  });

  test("rejects entries without string name and value fields", () => {
    expect(() => parseSecretEntries([{ name: "TEST_SECRET" }])).toThrow(
      "string value",
    );
    expect(() => parseSecretEntries([{ value: "value" }])).toThrow(
      "string name",
    );
  });
});
