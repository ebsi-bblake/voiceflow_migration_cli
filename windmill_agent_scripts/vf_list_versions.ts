import { resolveVoiceflowAuth } from "./vf_auth";
import { listVersions } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";

export async function main(
  token: string,
  workspaceID: string,
  projectID: string,
): Promise<Envelope<{ options: Awaited<ReturnType<typeof listVersions>> }>> {
  const id = crypto.randomUUID();
  try {
    return success("list_versions", id, {
      options: await listVersions(
        await resolveVoiceflowAuth(token),
        workspaceID,
        projectID,
      ),
    });
  } catch (error) {
    return failure("list_versions", id, error);
  }
}
