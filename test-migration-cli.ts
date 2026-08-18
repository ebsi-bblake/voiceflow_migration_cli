#!/usr/bin/env bun
import {
  sourceWorkspaceID,
  sourceProjectID,
  sourceVersionID,
  destinationWorkspaceID,
  destinationFolderID,
} from "./windmill_dynamic_selectors";
import { migrateProject } from "./project_migration_orchestrator";
import { asMigrationError, diagnostic } from "./migration_diagnostics";

type Option = { label: string; value: string };

const help = (): void => {
  console.log("Usage: bun test-migration-cli.ts");
  console.log(
    "Interactively export a Voiceflow version and import it into another workspace.",
  );
};

const bounded = (value: unknown, max = 200): string => {
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/[\u0000-\u001f\u007f]/g, " ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/**
 * Small stdin reader for the interactive Bun CLI.
 *
 * This deliberately does not use the Node readline compatibility layer.  Its pause/
 * resume state is separate from the stream's raw-mode state in Bun's Node
 * compatibility layer, which can leave stdin paused with no live event source.
 */
class PromptReader {
  private readonly input = process.stdin;
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private waiting: ((line: string) => void) | undefined;
  private listening = false;

  private readonly onData = (chunk: unknown): void => {
    if (typeof chunk === "string") this.buffer += chunk;
    else if (chunk instanceof Uint8Array)
      this.buffer += this.decoder.decode(chunk, { stream: true });
    this.resolveLineIfReady();
  };

  constructor() {
    this.attach();
    this.input.resume();
  }

  private attach(): void {
    if (!this.listening) {
      this.input.on("data", this.onData);
      this.listening = true;
    }
  }

  private detach(): void {
    if (this.listening) {
      this.input.off("data", this.onData);
      this.listening = false;
    }
  }

  private resolveLineIfReady(): void {
    if (!this.waiting) return;
    const newline = /[\r\n]/.exec(this.buffer);
    if (!newline || newline.index === undefined) return;

    const line = this.buffer.slice(0, newline.index);
    let end = newline.index + 1;
    if (this.buffer[newline.index] === "\r" && this.buffer[end] === "\n")
      end += 1;
    this.buffer = this.buffer.slice(end);

    const resolve = this.waiting;
    this.waiting = undefined;
    resolve(line);
  }

  ask(question: string): Promise<string> {
    if (this.waiting) throw new Error("A prompt is already waiting for input");
    process.stdout.write(question);
    return new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.resolveLineIfReady();
    });
  }

  async secret(question: string): Promise<string> {
    if (this.waiting) throw new Error("A prompt is already waiting for input");
    process.stdout.write(question);
    if (!this.input.isTTY || typeof this.input.setRawMode !== "function") {
      throw new Error("A TTY is required for hidden JWT input");
    }

    this.detach();
    this.input.setRawMode(true);
    this.input.resume();

    return await new Promise<string>((resolve) => {
      let value = "";
      let finished = false;
      const finish = (result: string, newline: boolean): void => {
        if (finished) return;
        finished = true;
        this.input.off("data", onData);
        this.input.setRawMode!(false);
        this.attach();
        this.input.resume();
        if (newline) process.stdout.write("\n");
        resolve(result);
      };
      const onData = (chunk: unknown): void => {
        const text =
          typeof chunk === "string"
            ? chunk
            : chunk instanceof Uint8Array
              ? new TextDecoder().decode(chunk)
              : String(chunk);
        for (const char of text) {
          if (char === "\r" || char === "\n") {
            finish(value, true);
            return;
          }
          if (char === "\u0003") {
            finish("", false);
            return;
          }
          if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
          else value += char;
        }
      };
      this.input.on("data", onData);
    });
  }

  close(): void {
    this.detach();
    if (this.input.isTTY && typeof this.input.setRawMode === "function")
      this.input.setRawMode(false);
    this.input.pause();
  }
}

const run = async (): Promise<void> => {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    help();
    return;
  }

  console.warn("WARNING: this performs a REAL Voiceflow export and import.");
  console.warn(
    "Use only the intended source version and destination workspace.",
  );

  const prompts = new PromptReader();
  const ask = (question: string) => prompts.ask(question);
  const choose = async (title: string, options: Option[]): Promise<string> => {
    if (!options.length)
      throw diagnostic("Catalog", "not-found", {
        endpoint: "catalog",
        nextAction: `No ${title.toLowerCase()} options were returned. Check access and migration inputs.`,
      });
    console.log(`\n${title}:`);
    options.forEach((option, index) =>
      console.log(
        `${index + 1}. ${bounded(option.label)} (${bounded(option.value, 100)})`,
      ),
    );
    while (true) {
      const number = Number.parseInt(await ask("Select number: "), 10);
      if (number >= 1 && number <= options.length)
        return options[number - 1].value;
      console.log("Please select one of the displayed numbers.");
    }
  };

  try {
    const token = await prompts.secret("Raw JWT (input hidden): ");
    const sourceWorkspace = await choose(
      "Source workspace",
      await sourceWorkspaceID(token),
    );
    const sourceProject = await choose(
      "Source project",
      await sourceProjectID(token, sourceWorkspace),
    );
    const sourceVersion = await choose(
      "Source draft/published version",
      await sourceVersionID(token, sourceWorkspace, sourceProject),
    );
    const destinationWorkspace = await choose(
      "Destination workspace",
      await destinationWorkspaceID(token),
    );
    const destinationFolder = await choose(
      "Destination folder",
      await destinationFolderID(token, destinationWorkspace),
    );
    const schema =
      (await ask("Target schema version [13.1]: ")).trim() || "13.1";
    const confirmation = (await ask("Perform this real migration? (yes/no): "))
      .trim()
      .toLowerCase();
    if (confirmation !== "yes" && confirmation !== "y") {
      console.log("Aborted; no migration performed.");
      return;
    }
    const result = await migrateProject(
      token,
      sourceWorkspace,
      sourceProject,
      sourceVersion,
      destinationWorkspace,
      destinationFolder,
      schema,
    );
    console.log(
      JSON.stringify({
        exportStatus: result.exportStatus,
        importStatus: result.importStatus,
        exportBytes: result.exportBytes,
        selected: result.selected,
        imported: result.imported,
        apiKeyRetrieved: result.apiKeyRetrieved,
        postImport: result.postImport,
      }),
    );
    if (result.postImport) {
      console.error("WARNING: migration completed, but API-key retrieval failed; see the sanitized postImport diagnostic.");
      console.error(JSON.stringify({ postImport: result.postImport }));
      process.exitCode = 2;
    }
  } catch (error) {
    const d = asMigrationError(error).diagnostic;
    console.error(JSON.stringify({ migrationFailed: { phase: d.phase, code: d.code, status: d.status, diagnosticId: d.diagnosticId, retryable: d.retryable, nextAction: d.nextAction } }));
    process.exitCode = 1;
  } finally {
    prompts.close();
  }
};

if (import.meta.main) {
  run().catch((error) =>
    (process.exitCode = 1, console.error(JSON.stringify({ migrationFailed: asMigrationError(error).diagnostic }))),
  );
}
