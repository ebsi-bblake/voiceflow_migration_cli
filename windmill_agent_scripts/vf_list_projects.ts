import { resolveVoiceflowAuth } from "./vf_auth";
import { listProjects } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";

export async function main(
  token: string,
  workspaceID: string,
): Promise<Envelope<{ options: Awaited<ReturnType<typeof listProjects>> }>> {
  const id = crypto.randomUUID();
  try {
    return success("list_projects", id, {
      options: await listProjects(
        await resolveVoiceflowAuth(token),
        workspaceID,
      ),
    });
  } catch (error) {
    return failure("list_projects", id, error);
  }
}
