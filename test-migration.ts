// WARNING: Running this CLI performs a real Voiceflow export and import.

type Values = {
  token?: string;
  sourceWorkspace?: string;
  sourceProject?: string;
  sourceVersion?: string;
  destinationWorkspace?: string;
  destinationFolder?: string;
  schemaVersion?: string;
};

const usage = `Usage: bun run test-migration.ts [options]

Performs a real Voiceflow export/import. Missing values are requested interactively.

Options:
  --token VALUE                 Voiceflow JWT (prompted silently if omitted)
  --source-workspace VALUE
  --source-project VALUE
  --source-version VALUE
  --destination-workspace VALUE
  --destination-folder VALUE
  --schema-version VALUE        Target schema version (default: 13.1)
  --help                        Show this help

Examples:
  bun run test-migration.ts
  bun run test-migration.ts --token JWT --source-workspace ws --source-project p \
    --source-version v --destination-workspace dws --destination-folder folder
`;

function value(args: string[], index: number, flag: string): [string, number] {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [next, index + 1];
}

function parse(args: string[]): Values {
  const result: Values = {};
  const names: Record<string, keyof Values> = {
    "--token": "token", "--source-workspace": "sourceWorkspace",
    "--source-project": "sourceProject", "--source-version": "sourceVersion",
    "--destination-workspace": "destinationWorkspace",
    "--destination-folder": "destinationFolder", "--schema-version": "schemaVersion",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help") { console.log(usage); process.exit(0); }
    const key = names[args[i]];
    if (!key) throw new Error(`Unknown option: ${args[i]}`);
    [result[key], i] = value(args, i, args[i]);
  }
  return result;
}

async function prompt(label: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${label}: `, (answer) => { rl.close(); resolve(answer.trim()); }));
}

async function secretPrompt(label: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY || !stdin.setRawMode) return prompt(label);
  process.stdout.write(`${label}: `);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let answer = "";
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) { cleanup(); reject(new Error("Input cancelled")); return; }
        if (byte === 13 || byte === 10) { cleanup(); process.stdout.write("\n"); resolve(answer.trim()); return; }
        if (byte === 127 || byte === 8) answer = answer.slice(0, -1);
        else if (byte >= 32) answer += String.fromCharCode(byte);
      }
    };
    const cleanup = () => { stdin.off("data", onData); stdin.setRawMode!(false); stdin.pause(); };
    stdin.on("data", onData);
  });
}

type Option = { label: string; value: string };

async function choose(label: string, options: Option[]): Promise<string> {
  if (!options.length) throw new Error(`No ${label} options were returned`);
  console.log(`\n${label}:`);
  options.forEach((option, index) => console.log(`  ${index + 1}) ${option.label}`));
  while (true) {
    const answer = await prompt("Select a number");
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && index >= 0 && index < options.length) return options[index].value;
    console.log(`Please select a number from 1 to ${options.length}.`);
  }
}

function selected(label: string, id: string, options: Option[]): string {
  const option = options.find((item) => item.value === id);
  if (!option) throw new Error(`Invalid ${label} ID "${id}" (not in fetched options)`);
  console.log(`Selected ${label}: ${option.label} (${id})`);
  return id;
}

async function run(): Promise<void> {
  const values = parse(process.argv.slice(2));
  const interactive = !values.token?.trim() || ["sourceWorkspace", "sourceProject", "sourceVersion", "destinationWorkspace", "destinationFolder"]
    .some((key) => !values[key as keyof Values]?.trim());
  if (!values.token?.trim()) values.token = await secretPrompt("JWT");
  {
    const { sourceWorkspaceID, sourceProjectID, sourceVersionID, destinationWorkspaceID, destinationFolderID } =
      await import("./migrate_voiceflow_project.ts");
    const sourceWorkspaces = await sourceWorkspaceID(values.token!);
    values.sourceWorkspace = values.sourceWorkspace
      ? selected("source workspace", values.sourceWorkspace.trim(), sourceWorkspaces)
      : await choose("Source workspaces", sourceWorkspaces);
    const projects = await sourceProjectID(values.token!, values.sourceWorkspace);
    values.sourceProject = values.sourceProject
      ? selected("source project", values.sourceProject.trim(), projects)
      : await choose("Source projects", projects);
    const versions = await sourceVersionID(values.token!, values.sourceWorkspace, values.sourceProject);
    values.sourceVersion = values.sourceVersion
      ? selected("source version", values.sourceVersion.trim(), versions)
      : await choose("Source versions", versions);
    const destinationWorkspaces = await destinationWorkspaceID(values.token!);
    values.destinationWorkspace = values.destinationWorkspace
      ? selected("destination workspace", values.destinationWorkspace.trim(), destinationWorkspaces)
      : await choose("Destination workspaces", destinationWorkspaces);
    const folders = await destinationFolderID(values.token!, values.destinationWorkspace);
    values.destinationFolder = values.destinationFolder
      ? selected("destination folder", values.destinationFolder.trim(), folders)
      : await choose("Destination folders", folders);
  }
  values.schemaVersion = values.schemaVersion?.trim() || "13.1";
  const missing = ["sourceWorkspace", "sourceProject", "sourceVersion", "destinationWorkspace", "destinationFolder"]
    .filter((key) => !values[key as keyof Values]?.trim());
  if (missing.length) throw new Error(`Missing required values: ${missing.join(", ")}`);
  if (interactive) {
    const confirmation = await prompt(`WARNING: this performs a REAL export/import. Continue? [y/N]`);
    if (!/^(y|yes)$/i.test(confirmation)) { console.log("Aborted."); return; }
  }
  const { main } = await import("./migrate_voiceflow_project.ts");
  const result = await main(values.token!, values.sourceWorkspace!, values.sourceProject!, values.sourceVersion!, values.destinationWorkspace!, values.destinationFolder!, values.schemaVersion);
  const imported = result.importResponse && typeof result.importResponse === "object" ? result.importResponse as Record<string, unknown> : {};
  const importedIDs: Record<string, string> = {};
  for (const key of ["projectID", "projectId", "versionID", "versionId", "assistantID", "assistantId", "id"]) if (typeof imported[key] === "string" || typeof imported[key] === "number") importedIDs[key] = String(imported[key]);
  console.log(JSON.stringify({ exportStatus: result.exportStatus, importStatus: result.importStatus, exportBytes: result.exportBytes, selected: result.selected, importedIDs }));
}

if (import.meta.main) try { await run(); } catch (error) {
  const message = error instanceof Error ? error.message : "Migration failed";
  console.error(`Migration failed: ${message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 500)}`);
  process.exitCode = 1;
}
