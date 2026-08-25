// Windmill setup: add this script to a Bun runtime and mark token as a secret.
// The five DynSelect_* exports are the dynamic-select input types used by Windmill.

export type DynSelect_sourceWorkspaceID = string;
export type DynSelect_sourceProjectID = string;
export type DynSelect_sourceVersionID = string;
export type DynSelect_destinationWorkspaceID = string;
export type DynSelect_destinationFolderID = string;

type Option = { value: string; label: string };
type AnyRecord = Record<string, any>;

const REALTIME = "wss://realtime.empyrean.voiceflow.com/";

function normalizeToken(input: unknown): string {
  if (typeof input !== "string")
    throw new Error("Authentication token must be a string");
  const token = input
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) throw new Error("Authentication token is empty");
  if (token.split(".").length !== 3)
    throw new Error("Authentication token must be a JWT");
  return token;
}

function jwtClaims(token: string): AnyRecord {
  const part = token.split(".")[1];
  if (!part) throw new Error("JWT has no claims");
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
        (c) => c.charCodeAt(0),
      ),
    ),
  );
}

function creatorID(token: string): string {
  const claims = jwtClaims(normalizeToken(token));
  const id = claims.creatorID ?? claims.userID ?? claims.user_id ?? claims.sub;
  if (!id) throw new Error("JWT does not contain a creator/user ID");
  return String(id);
}

function random8(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

async function importDiagnostic(
  response: Response,
  token: string,
): Promise<string> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return "non-JSON response body";
  }
  const record = body && typeof body === "object" ? (body as AnyRecord) : {};
  const values = [record.message, record.error, record.code].filter(
    (value) => typeof value === "string" || typeof value === "number",
  );
  if (values.length === 0) return "response contained no safe diagnostic";
  return values
    .join("; ")
    .replaceAll(token, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function sync(
  token: string,
  channels: string[],
  wanted: string[],
): Promise<AnyRecord[]> {
  return new Promise((resolve, reject) => {
    const authToken = normalizeToken(token);
    const ws = new WebSocket(REALTIME);
    const clientID = `${creatorID(authToken)}:${random8()}:${random8()}`;
    const found: AnyRecord[] = [];
    const receivedTypes = new Set<string>();
    const requestID = Math.floor(Math.random() * 1_000_000_000) + 1;
    let nextActionID = -1;
    let nextActionTime = 1;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(found);
    };
    const timer = setTimeout(() => {
      ws.close();
      finish(new Error("Logux connection timed out"));
    }, 15000);
    ws.onerror = () => finish(new Error("Logux websocket error"));
    ws.onclose = () => {
      if (found.length === 0)
        finish(new Error("Logux websocket closed before sync"));
    };
    ws.onmessage = (event) => {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.[0] === "error") {
        // Do not include the server frame: an error frame could echo credentials.
        const reason =
          message?.[1] === "wrong-credentials"
            ? "wrong-credentials"
            : "server-rejected";
        finish(new Error(`Logux connection rejected (${reason})`));
        return;
      }
      if (message?.[0] === "connected") {
        // Logux subscriptions are sync actions. A bare ["subscribe", ...]
        // frame is rejected by the realtime server as an unknown message.
        for (const channel of channels) {
          ws.send(
            JSON.stringify([
              "sync",
              requestID,
              {
                channel,
                type: "logux/subscribe",
                since: { id: "0", time: 0 },
              },
              { id: nextActionID--, time: nextActionTime++ },
            ]),
          );
        }
        return;
      }
      if (message?.[0] !== "sync") return;
      const action = message[2];
      if (typeof action?.type === "string") receivedTypes.add(action.type);
      if (
        action?.type === "workspace.CRUD:REPLACE" &&
        Array.isArray(action.payload?.values)
      )
        found.push(...action.payload.values);
      if (
        action?.type === "project.CRUD:REPLACE" &&
        Array.isArray(action.payload?.values)
      )
        found.push(...action.payload.values);
      if (
        action?.type === "workspace-folder.REPLACE" &&
        Array.isArray(action.payload?.data)
      )
        found.push(...action.payload.data);
      if (wanted.every((t) => receivedTypes.has(t))) {
        finish();
        ws.close();
      }
    };
    ws.onopen = () => {
      ws.send(
        JSON.stringify([
          "connect",
          4,
          clientID,
          0,
          { token: authToken, subprotocol: "1.9.0" },
        ]),
      );
    };
  });
}

async function records(
  token: string,
  channel: string,
  types: string[],
): Promise<AnyRecord[]> {
  return sync(normalizeToken(token), [channel], types);
}

export async function sourceWorkspaceID(token: string): Promise<Option[]> {
  const authToken = normalizeToken(token);
  const rows = await records(authToken, `creator/${creatorID(authToken)}`, [
    "workspace.CRUD:REPLACE",
  ]);
  return rows
    .filter((x) => x.id)
    .map((x) => ({
      value: String(x.id),
      label: String(x.name ?? x.title ?? x.id),
    }));
}

export async function sourceProjectID(
  token: string,
  sourceWorkspaceID: string,
): Promise<Option[]> {
  const rows = await records(
    normalizeToken(token),
    `workspace/${sourceWorkspaceID}`,
    ["project.CRUD:REPLACE"],
  );
  return rows
    .filter((x) => String(x.workspaceID) === sourceWorkspaceID && x.id)
    .map((x) => ({
      value: String(x.id),
      label: String(x.name ?? x.title ?? x.id),
    }));
}

export async function sourceVersionID(
  token: string,
  sourceWorkspaceID: string,
  sourceProjectID: string,
): Promise<Option[]> {
  const rows = await records(
    normalizeToken(token),
    `workspace/${sourceWorkspaceID}`,
    ["project.CRUD:REPLACE"],
  );
  const project = rows.find(
    (x) =>
      String(x.id) === sourceProjectID &&
      String(x.workspaceID) === sourceWorkspaceID,
  );
  const environments = Array.isArray(project?.environments)
    ? project.environments
    : Object.values(project?.environments ?? {});
  const options: Option[] = [];
  for (const environment of environments as AnyRecord[]) {
    const name = String(
      environment.name ?? environment.label ?? environment.id ?? "Environment",
    );
    if (project) {
      if (environment.draftVersionID)
        options.push({
          value: String(environment.draftVersionID),
          label: `[Draft] ${project.name ?? project.title ?? sourceProjectID} — ${name}`,
        });
      if (environment.publishedVersionID)
        options.push({
          value: String(environment.publishedVersionID),
          label: `[Published] ${project.name ?? project.title ?? sourceProjectID} — ${name}`,
        });
    }
  }
  return options;
}

export async function destinationWorkspaceID(token: string): Promise<Option[]> {
  return sourceWorkspaceID(token);
}

export async function destinationFolderID(
  token: string,
  destinationWorkspaceID: string,
): Promise<Option[]> {
  const rows = await records(token, `workspace/${destinationWorkspaceID}`, [
    "workspace-folder.REPLACE",
  ]);
  return rows
    .filter((x) => String(x.workspaceID) === destinationWorkspaceID && x.id)
    .map((x) => ({
      value: String(x.id),
      label: String(x.name ?? x.title ?? x.id),
    }));
}

export async function main(
  token: string,
  sourceWorkspaceID: DynSelect_sourceWorkspaceID,
  sourceProjectID: DynSelect_sourceProjectID,
  sourceVersionID: DynSelect_sourceVersionID,
  destinationWorkspaceID: DynSelect_destinationWorkspaceID,
  destinationFolderID: DynSelect_destinationFolderID,
  targetSchemaVersion = "13.1",
) {
  const authToken = normalizeToken(token);
  const response = await fetch(
    `https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/export-json/${encodeURIComponent(sourceVersionID)}`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    },
  );
  if (response.status === 304 || !response.ok)
    throw new Error(`Export failed with HTTP ${response.status}`);
  const exported = await response.arrayBuffer();
  const filename = `voiceflow-${sourceVersionID}.vf`;
  const form = new FormData();
  form.append(
    "file",
    new Blob([exported], { type: "application/octet-stream" }),
    filename,
  );
  form.append("targetSchemaVersion", targetSchemaVersion);
  form.append("folderID", destinationFolderID);
  const imported = await fetch(
    `https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/import-file/${encodeURIComponent(destinationWorkspaceID)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json",
      },
      body: form,
    },
  );
  if (!imported.ok) {
    const diagnostic = await importDiagnostic(imported, authToken);
    throw new Error(
      `Import failed with HTTP ${imported.status}: ${diagnostic}`,
    );
  }
  const importResponse = await imported.json();
  return {
    exportStatus: response.status,
    importStatus: imported.status,
    exportBytes: exported.byteLength,
    selected: {
      sourceWorkspaceID,
      sourceProjectID,
      sourceVersionID,
      destinationWorkspaceID,
      destinationFolderID,
    },
    importResponse,
  };
}
