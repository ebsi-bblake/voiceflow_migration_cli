import { describe, expect, test } from "bun:test";

import { folderOptions } from "../agent_scripts/vf_catalog";
import { importVersion } from "../agent_scripts/vf_import";

describe("Voiceflow destination-folder validation", () => {
  test("excludes project IDs from folder options", () => {
    const options = folderOptions(
      [
        {
          id: "6a8353e05b254446fc52750e",
          label: "Project record",
          workspaceID: "workspace-1",
        },
        { id: "42", label: "boaz-test", workspaceID: "workspace-1" },
      ],
      "workspace-1",
    );

    expect(options).toEqual([{ value: "42", label: "boaz-test" }]);
  });

  test("rejects a project ID before the import request", async () => {
    const result = importVersion(
      { token: "header.payload.signature", creatorID: "creator-1" },
      {
        status: 200,
        bytes: new ArrayBuffer(0),
        filename: "voiceflow-export.vf",
        contentType: "application/octet-stream",
      },
      "workspace-1",
      "6a8353e05b254446fc52750e",
      "13.1",
    );

    await expect(result).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
