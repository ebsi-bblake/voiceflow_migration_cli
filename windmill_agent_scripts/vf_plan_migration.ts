import { buildMigrationPlan } from "./vf_planning";
import { resolveVoiceflowAuth } from "./vf_auth";
import { success, failure, type MigrationSelection } from "./vf_contracts";
import type { Envelope, MigrationPlan } from "./vf_contracts";
export async function main(
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
  sourceVersionID: string,
  destinationWorkspaceID: string,
  destinationFolderID: string,
  targetSchemaVersion = "13.1",
): Promise<Envelope<MigrationPlan>> {
  const id = crypto.randomUUID();
  const selection: MigrationSelection = {
    sourceWorkspaceID,
    sourceProjectID,
    sourceVersionID,
    destinationWorkspaceID,
    destinationFolderID,
    targetSchemaVersion,
  };
  try {
    const auth = await resolveVoiceflowAuth(token);
    return success(
      "plan-migration",
      id,
      await buildMigrationPlan(auth, selection),
    );
  } catch (error) {
    return failure("plan-migration", id, error);
  }
}
