import type { AuthContext } from "./jwt_authentication_context.ts";
import { diagnostic } from "./migration_diagnostics.ts";
const URL = "wss://realtime.empyrean.voiceflow.com/";
export async function sync(
  auth: AuthContext,
  channel: string,
  wanted: string[],
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL),
      rows: Record<string, unknown>[] = [],
      types = new Set<string>();
    let done = false,
      action = -1;
    const timer = setTimeout(
      () => finish(diagnostic("Catalog", "timeout", { endpoint: "catalog" })),
      15_000,
    );
    const finish = (e?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      e ? reject(e) : resolve(rows);
    };
    ws.onerror = () => finish(diagnostic("Catalog", "network-error", { endpoint: "catalog" }));
    ws.onclose = () => {
      if (!done) finish(diagnostic("Catalog", "network-error", { endpoint: "catalog" }));
    };
    ws.onopen = () =>
      ws.send(
        JSON.stringify([
          "connect",
          4,
          `${auth.creatorID}:${crypto.randomUUID().slice(0, 8)}`,
          0,
          { token: auth.token, subprotocol: "1.9.0" },
        ]),
      );
    ws.onmessage = (e) => {
      const text = String(e.data);
      if (text.length > 2_000_000)
        return finish(diagnostic("Catalog", "response-too-large", { endpoint: "catalog", responseSize: text.length }));
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      switch (frame?.[0]) {
        case "error":
          return finish(diagnostic("Catalog", "server-error", { endpoint: "catalog" }));
        case "connected":
          ws.send(
            JSON.stringify([
              "sync",
              Date.now(),
              { channel, type: "logux/subscribe", since: { id: "0", time: 0 } },
              { id: action--, time: 1 },
            ]),
          );
          break;
        case "sync": {
          const a = Array.isArray(frame) ? frame[2] as Record<string, unknown> : undefined;
          // Logux sends several action types on a channel.  Only the requested
          // action is part of this catalog, and the two catalog actions use
          // different payload properties.
          const type = typeof a?.type === "string" ? a.type : undefined;
          const values = type && wanted.includes(type)
            ? type === "workspace.CRUD:REPLACE" || type === "project.CRUD:REPLACE"
              ? a?.payload?.values
              : type === "workspace-folder.REPLACE"
                ? a?.payload?.data
                : undefined
            : undefined;
          if (Array.isArray(values)) {
            rows.push(...values.filter((x) => x && typeof x === "object"));
            if (type) types.add(type);
          }
          if (wanted.every((x) => types.has(x))) finish();
          break;
        }
      }
    };
  });
}
