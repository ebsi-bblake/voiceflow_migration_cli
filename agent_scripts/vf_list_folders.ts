import { resolveVoiceflowAuth } from "./vf_auth";
import { listFolders } from "./vf_catalog";
import { failure, success } from "./vf_contracts";
import type { Envelope } from "./vf_contracts";
export async function main(
  token: string,
  workspaceID: string,
): Promise<Envelope<{ options: Awaited<ReturnType<typeof listFolders>> }>> {
  const id = crypto.randomUUID();
  try {
    return success("list-folders", id, {
      options: await listFolders(
        await resolveVoiceflowAuth(token),
        workspaceID,
      ),
    });
  } catch (error) {
    return failure("list-folders", id, error);
  }
}
