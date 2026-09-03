import { buildMigrationPlan } from "./vf_planning";
import { resolveVoiceflowAuth } from "./vf_auth";
import { success, failure, type MigrationSelection } from "./vf_contracts";
import type { Envelope, MigrationPlan } from "./vf_contracts";

async function runPlanning(
  token: string,
  id: string,
  selection: MigrationSelection,
): Promise<Envelope<MigrationPlan>> {
  try {
    const auth = await resolveVoiceflowAuth(token);
    return success(
      "plan_migration",
      id,
      await buildMigrationPlan(auth, selection),
    );
  } catch (error) {
    return failure("plan_migration", id, error);
  }
}

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
  return runPlanning(token, id, selection);
}
