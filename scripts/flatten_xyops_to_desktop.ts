import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

type FlattenOptions = Readonly<{
  sourceDirectory: string;
  destinationDirectory: string;
  dryRun: boolean;
}>;

type DomainFiles = Readonly<Record<string, readonly string[]>>;

const defaultSourceDirectory = resolve(process.cwd(), "xyops");
const defaultDestinationDirectory = join(homedir(), "Desktop", "xyops");
const domains = ["cli", "plugin", "voiceflow"] as const;

type Domain = (typeof domains)[number];

const parseOptions = (arguments_: readonly string[]): FlattenOptions => {
  const positional = arguments_.filter((argument) => argument !== "--dry-run");
  return {
    sourceDirectory: resolve(positional[0] ?? defaultSourceDirectory),
    destinationDirectory: resolve(positional[1] ?? defaultDestinationDirectory),
    dryRun: arguments_.includes("--dry-run"),
  };
};

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const listFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nestedFiles.flat().sort();
};

const isMetadataFile = (source: string): boolean => basename(source) === ".DS_Store";

const domainFor = (sourceDirectory: string, source: string): Domain => {
  const domain = relative(sourceDirectory, source).split(/[\\/]/u)[0];
  if (!domains.includes(domain as Domain))
    throw new Error(`Unexpected xyops domain: ${domain}`);
  return domain as Domain;
};

const groupByDomain = (
  sourceDirectory: string,
  files: readonly string[],
): DomainFiles => {
  const grouped: Record<Domain, string[]> = {
    cli: [],
    plugin: [],
    voiceflow: [],
  };
  for (const file of files.filter((value) => !isMetadataFile(value)))
    grouped[domainFor(sourceDirectory, file)].push(file);
  return grouped;
};

const sourceName = (sourceDirectory: string, source: string): string =>
  relative(sourceDirectory, source).replaceAll("\\", "/");

const buildBundle = async (
  sourceDirectory: string,
  files: readonly string[],
): Promise<string> => {
  const sections = await Promise.all(
    files.map(async (source) => {
      const content = await readFile(source, "utf8");
      return `========${sourceName(sourceDirectory, source)}=====\n${content}`;
    }),
  );
  return `${sections.join("\n\n")}\n`;
};

const writeBundles = async (
  sourceDirectory: string,
  destinationDirectory: string,
  groupedFiles: DomainFiles,
): Promise<void> => {
  await mkdir(destinationDirectory, { recursive: true });
  await Promise.all(
    domains.map(async (domain) => {
      const content = await buildBundle(sourceDirectory, groupedFiles[domain]);
      await writeFile(join(destinationDirectory, `${domain}.md`), content, "utf8");
    }),
  );
};

const printPlan = (
  destinationDirectory: string,
  groupedFiles: DomainFiles,
): void => {
  const sourceCount = Object.values(groupedFiles).reduce(
    (total, files) => total + files.length,
    0,
  );
  console.log(
    `${sourceCount} source files collapsed into 3 Markdown files in ${destinationDirectory}:`,
  );
  for (const domain of domains)
    console.log(`  ${domain}: ${groupedFiles[domain].length} files -> ${domain}.md`);
};

type Main = (arguments_: readonly string[]) => Promise<void>;
const main: Main = async (arguments_) => {
  const options = parseOptions(arguments_);
  if (!(await isDirectory(options.sourceDirectory)))
    throw new Error(`Source directory does not exist: ${options.sourceDirectory}`);
  const files = await listFiles(options.sourceDirectory);
  const groupedFiles = groupByDomain(options.sourceDirectory, files);
  printPlan(options.destinationDirectory, groupedFiles);
  if (!options.dryRun)
    await writeBundles(
      options.sourceDirectory,
      options.destinationDirectory,
      groupedFiles,
    );
  console.log(options.dryRun ? "Dry run complete." : "Bundles written.");
};

main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
