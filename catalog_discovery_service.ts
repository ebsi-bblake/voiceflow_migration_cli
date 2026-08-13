import { authenticate } from "./jwt_authentication_context.ts";
import { sync } from "./logux_websocket_transport.ts";
import { diagnostic } from "./migration_diagnostics.ts";
export type Option = { value: string; label: string };
type Row = Record<string, unknown>;
const validId = (value: string, name: string): string => {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw diagnostic("Catalog", "invalid-input", { endpoint: "catalog", nextAction: `Provide a valid ${name}.` });
  return id;
};
const options = (rows: Row[], filter: (r: Row) => boolean) =>
  [
    ...new Map(
      rows
        .filter((r) => {
          const id = String(r.id ?? "").trim();
          return id.length > 0 && filter(r);
        })
        .map((r) => [
          String(r.id).trim(),
          { value: String(r.id).trim(), label: String(r.name ?? r.title ?? r.id).trim() },
        ] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
export const buildOptions = (rows: Row[]) => options(rows, () => true);
export const listWorkspaces = async (token: string) => {
  const a = authenticate(token);
  return options(
    await sync(a, `creator/${a.creatorID}`, ["workspace.CRUD:REPLACE"]),
    () => true,
  );
};
export const listProjects = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return options(
    await sync(a, `workspace/${workspaceID}`, ["project.CRUD:REPLACE"]),
    (r) => String(r.workspaceID) === workspaceID,
  );
};
export const listVersions = async (
  token: string,
  workspaceID: string,
  projectID: string,
) => {
  workspaceID = validId(workspaceID, "workspace ID");
  projectID = validId(projectID, "project ID");
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
};
export const listFolders = async (token: string, workspaceID: string) => {
  const a = authenticate(token);
  workspaceID = validId(workspaceID, "workspace ID");
  return options(
    await sync(a, `workspace/${workspaceID}`, ["workspace-folder.REPLACE"]),
    (r) => {
      const id = String(r.id ?? "").trim();
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const scope = r.scope;
      return /^\d+$/.test(id) &&
        String(r.workspaceID) === workspaceID &&
        name.length > 0 &&
        (scope === undefined || scope === "assistant");
    },
  );
};
