import { expect, test } from "bun:test";

import { parseSSE } from "../xyops/cli/client/streaming";

const stream = (body: string): string => body;

test("parses lifecycle events, comments, and multiple data lines", () => {
  expect(
    parseSSE(
      stream(
        ": keep-alive\n\nevent: update\ndata: {\"id\":\"job-1\",\ndata: \"code\":0}\n\nevent: end\ndata: {}\n\n",
      ),
    ),
  ).toEqual([
    { type: "update", data: { id: "job-1", code: 0 } },
    { type: "end", data: {} },
  ]);
});

test("rejects malformed JSON and unknown events", () => {
  expect(() => parseSSE("event: update\ndata: nope\n\n")).toThrow("stream");
  expect(() => parseSSE("event: unknown\ndata: {}\n\n")).toThrow("stream");
});

test("enforces total and frame byte limits", () => {
  const body = "event: start\ndata: {}\n\n";
  expect(() => parseSSE(body, { maxBytes: 2 })).toThrow("stream");
  expect(() => parseSSE(body, { maxFrameBytes: 2 })).toThrow("stream");
});
