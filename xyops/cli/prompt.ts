import type { Option } from "./types";

/** A line reader that does not depend on the Node readline pause/resume shim. */
export class PromptReader {
  private readonly input = process.stdin;
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private waiting: ((line: string) => void) | undefined;
  private listening = false;

  private readonly onData = (chunk: unknown): void => {
    this.buffer += readChunk(chunk, this.decoder);
    this.resolveLineIfReady();
  };

  constructor() {
    this.input.on("data", this.onData);
    this.listening = true;
    this.input.resume();
  }

  private resolveLineIfReady(): void {
    const resolve = this.waiting;
    if (!resolve) return;
    this.resolveWaitingLine(resolve);
  }

  private resolveWaitingLine(resolve: (line: string) => void): void {
    const newline = findNewline(this.buffer);
    if (newline === undefined) return;
    const line = this.buffer.slice(0, newline.index);
    const end = newline.end;
    this.buffer = this.buffer.slice(end);
    this.waiting = undefined;
    resolve(line);
  }

  ask(question: string): Promise<string> {
    if (this.waiting)
      return Promise.reject(new Error("A prompt is already waiting for input"));
    process.stdout.write(question);
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.resolveLineIfReady();
    });
  }

  close(): void {
    if (this.listening) this.input.off("data", this.onData);
    this.listening = false;
    this.input.pause();
  }
}

type ReadChunk = (chunk: unknown, decoder: TextDecoder) => string;
const readStringChunk = (chunk: unknown): string | undefined =>
  typeof chunk === "string" ? chunk : undefined;
const readBytesChunk = (
  chunk: unknown,
  decoder: TextDecoder,
): string | undefined =>
  chunk instanceof Uint8Array
    ? decoder.decode(chunk, { stream: true })
    : undefined;
const firstDefined = (values: readonly (string | undefined)[]): string =>
  values.find((value) => value !== undefined) ?? "";
const readChunk: ReadChunk = (chunk, decoder) =>
  firstDefined([readStringChunk(chunk), readBytesChunk(chunk, decoder)]);
type Newline = Readonly<{ index: number; end: number }>;
const findNewline = (buffer: string): Newline | undefined => {
  const indices = [buffer.indexOf("\r"), buffer.indexOf("\n")].filter(
    (index) => index >= 0,
  );
  if (!indices.length) return undefined;
  const index = Math.min(...indices);
  return { index, end: newlineEnd(buffer, index) };
};
const newlineEnd = (buffer: string, index: number): number =>
  index + (Number(buffer.startsWith("\r\n", index)) + 1);

type Bounded = (value: unknown, max?: number) => string;
const isControlCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
};
const stringifyFallback = (value: unknown): string =>
  JSON.stringify(value) ?? String(value);
const stringifyValue = (value: unknown): string =>
  typeof value === "string" ? value : stringifyFallback(value);
const sanitizeText = (text: string): string =>
  [...text]
    .map((character) => (isControlCharacter(character) ? " " : character))
    .join("");
const truncateText = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;
export const bounded: Bounded = (value, max = 200) =>
  truncateText(sanitizeText(stringifyValue(value)), max);

type ChooseOption = (
  reader: PromptReader,
  title: string,
  options: readonly Option[],
) => Promise<string>;
const isOptionNumber = (number: number, length: number): boolean =>
  number >= 1 && number <= length;
const requireOptions = (
  title: string,
  options: readonly Option[],
): readonly Option[] => {
  if (!options.length)
    throw new Error(`No ${title.toLowerCase()} options were returned.`);
  return options;
};
const readOption = (
  reader: PromptReader,
  options: readonly Option[],
): Promise<string> =>
  reader.ask("Select number: ").then((answer) => {
    const number = Number.parseInt(answer, 10);
    if (isOptionNumber(number, options.length))
      return options[number - 1].value;
    console.log("Please select one of the displayed numbers.");
    return readOption(reader, options);
  });
export const chooseOption: ChooseOption = async (reader, title, options) => {
  const validOptions = requireOptions(title, options);
  console.log(`\n${title}:`);
  options.forEach((option, index) =>
    console.log(
      `${index + 1}. ${bounded(option.label)} (${bounded(option.value, 100)})`,
    ),
  );
  return readOption(reader, validOptions);
};
