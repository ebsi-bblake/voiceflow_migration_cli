import type { Option } from "./contracts";

/** A line reader that does not depend on the Node readline pause/resume shim. */
export class PromptReader {
  private readonly input = process.stdin;
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private waiting: ((line: string) => void) | undefined;
  private listening = false;

  private readonly onData = (chunk: unknown): void => {
    this.buffer += typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? this.decoder.decode(chunk, { stream: true }) : "";
    this.resolveLineIfReady();
  };

  constructor() {
    this.input.on("data", this.onData);
    this.listening = true;
    this.input.resume();
  }

  private resolveLineIfReady(): void {
    if (!this.waiting) return;
    const newline = /[\r\n]/.exec(this.buffer);
    if (!newline || newline.index === undefined) return;
    const line = this.buffer.slice(0, newline.index);
    let end = newline.index + 1;
    if (this.buffer[newline.index] === "\r" && this.buffer[end] === "\n") end += 1;
    this.buffer = this.buffer.slice(end);
    const resolve = this.waiting;
    this.waiting = undefined;
    resolve(line);
  }

  ask(question: string): Promise<string> {
    if (this.waiting) return Promise.reject(new Error("A prompt is already waiting for input"));
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

type Bounded = (value: unknown, max?: number) => string;
export const bounded: Bounded = (value, max = 200) => {
  const text = (typeof value === "string" ? value : JSON.stringify(value) ?? String(value)).replace(/[\u0000-\u001f\u007f]/g, " ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

type ChooseOption = (reader: PromptReader, title: string, options: readonly Option[]) => Promise<string>;
export const chooseOption: ChooseOption = async (reader, title, options) => {
  if (!options.length) throw new Error(`No ${title.toLowerCase()} options were returned.`);
  console.log(`\n${title}:`);
  options.forEach((option, index) => console.log(`${index + 1}. ${bounded(option.label)} (${bounded(option.value, 100)})`));
  while (true) {
    const number = Number.parseInt(await reader.ask("Select number: "), 10);
    if (number >= 1 && number <= options.length) return options[number - 1].value;
    console.log("Please select one of the displayed numbers.");
  }
};
