import type { AuthContext } from "./jwt_authentication_context.ts";
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
      () => finish(new Error("Logux sync timed out")),
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
    ws.onerror = () => finish(new Error("Logux websocket error"));
    ws.onclose = () => {
      if (!done) finish(new Error("Logux websocket closed"));
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
        return finish(new Error("Logux frame is too large"));
      let frame: any;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      switch (frame?.[0]) {
        case "error":
          return finish(new Error("Logux server rejected request"));
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
          const a = frame[2];
          if (typeof a?.type === "string") types.add(a.type);
          const values = a?.payload?.values ?? a?.payload?.data;
          if (Array.isArray(values))
            rows.push(...values.filter((x) => x && typeof x === "object"));
          if (wanted.every((x) => types.has(x))) finish();
          break;
        }
      }
    };
  });
}
