import { describe, expect, test } from "bun:test";
import {
  parseSecretEntries,
  parseSecretEntriesJSON,
  parseSecretsFile,
} from "../xyops/voiceflow/vf_secrets";
import { parseSecretEntries as parseArchivedSecretEntries } from "../windmill_agent_scripts/vf_secrets";

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

  test("rejects malformed and duplicate entries", () => {
    const malformed = [
      [{ name: "TEST_SECRET" }],
      [{ value: "value" }],
      [{ name: "TEST_SECRET", value: "value", extra: true }],
    ];
    malformed.forEach((entries) => {
      expect(() => parseSecretEntries(entries)).toThrow();
      expect(() => parseArchivedSecretEntries(entries)).toThrow();
    });
    const duplicate = [
      { name: "TEST_SECRET", value: "first" },
      { name: "TEST_SECRET", value: "second" },
    ];
    expect(() => parseSecretEntries(duplicate)).toThrow("duplicate");
    expect(() => parseArchivedSecretEntries(duplicate)).toThrow("duplicate");
  });

  test("keeps active and archived parsers aligned for valid entries", () => {
    const entries = [
      { name: "FIRST_SECRET", value: "first value" },
      { name: "SECOND_SECRET", value: "second value" },
    ];
    expect(parseArchivedSecretEntries(entries)).toEqual(parseSecretEntries(entries));
  });
});
