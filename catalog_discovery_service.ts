import { authenticate } from "./jwt_authentication_context.ts";
import { sync } from "./logux_websocket_transport.ts";
export type Option = { value: string; label: string };
type Row = Record<string, any>;
const options = (rows: Row[], filter: (r: Row) => boolean) =>
  [
    ...new Map(
      rows
        .filter((r) => r.id != null && filter(r))
        .map((r) => [
          String(r.id),
          { value: String(r.id), label: String(r.name ?? r.title ?? r.id) },
        ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
export const buildOptions = (rows: Row[]) => options(rows, () => true);
export async function listWorkspaces(token: string) {
  const a = authenticate(token);
  return options(
    await sync(a, `creator/${a.creatorID}`, ["workspace.CRUD:REPLACE"]),
    () => true,
  );
}
export async function listProjects(token: string, workspaceID: string) {
  const a = authenticate(token);
  return options(
    await sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"]),
    (r) => String(r.workspaceID) === workspaceID,
  );
}
export async function listVersions(
  token: string,
  workspaceID: string,
  projectID: string,
) {
  const a = authenticate(token),
    p = (
      await sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"])
    ).find((r) => String(r.id) === projectID);
  const env = Array.isArray(p?.environments)
    ? p.environments
    : Object.values(p?.environments ?? {});
  return env
    .flatMap((e: any) =>
      [
        e.draftVersionID && {
          value: String(e.draftVersionID),
          label: `[Draft] ${p?.name ?? projectID} — ${e.name ?? e.id}`,
        },
        e.publishedVersionID && {
          value: String(e.publishedVersionID),
          label: `[Published] ${p?.name ?? projectID} — ${e.name ?? e.id}`,
        },
      ].filter(Boolean),
    )
    .sort((a: any, b: any) => a.label.localeCompare(b.label));
}
export async function listFolders(token: string, workspaceID: string) {
  const a = authenticate(token);
  return options(
    await sync(a, `workspace/${workspaceID}`, ["workspace-folder.REPLACE"]),
    (r) => String(r.workspaceID) === workspaceID,
  );
}
