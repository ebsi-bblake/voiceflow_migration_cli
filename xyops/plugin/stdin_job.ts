import { parsePluginJob } from "./job_validation";
import type { NativePluginJob } from "./contracts";

export type PluginInputChunk = Uint8Array | string;
export type PluginInput = AsyncIterable<PluginInputChunk>;

type ReadPluginInput = (input: PluginInput) => Promise<string>;
export const readPluginInput: ReadPluginInput = async (input) => {
  const decoder = new TextDecoder();
  let value = "";
  for await (const chunk of input) {
    value += typeof chunk === "string"
      ? chunk
      : decoder.decode(chunk, { stream: true });
  }
  return value + decoder.decode();
};

type ReadPluginJob = (input: PluginInput) => Promise<NativePluginJob>;
export const readPluginJob: ReadPluginJob = (input) =>
  readPluginInput(input).then(parsePluginJob);
