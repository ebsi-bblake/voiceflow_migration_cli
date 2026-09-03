import { listWorkspaces } from "./vf_catalog";
import { resolveVoiceflowAuth } from "./vf_auth";
import { success, failure } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";

export async function main(
  token: string,
): Promise<Envelope<{ options: Awaited<ReturnType<typeof listWorkspaces>> }>> {
  const id = crypto.randomUUID();
  try {
    return success("list_workspaces", id, {
      options: await listWorkspaces(await resolveVoiceflowAuth(token)),
    });
  } catch (error) {
    return failure("list_workspaces", id, error);
  }
}
