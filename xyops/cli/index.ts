#!/usr/bin/env bun
import { asCliError, cliErrorOutput } from "./diagnostics";
import { run } from "./migration";

export { run } from "./migration";

if (import.meta.main) {
  run().catch((error: unknown) => {
    process.exitCode = 1;
    console.error(
      JSON.stringify({ migrationFailed: cliErrorOutput(asCliError(error)) }),
    );
  });
}
