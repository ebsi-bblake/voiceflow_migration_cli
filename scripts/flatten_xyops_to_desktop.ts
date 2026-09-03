import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

type FlattenOptions = Readonly<{
  sourceDirectory: string;
  destinationDirectory: string;
  dryRun: boolean;
}>;

const defaultSourceDirectory = resolve(process.cwd(), "xyops");
const defaultDestinationDirectory = join(homedir(), "Desktop", "xyops");

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

const sourceName = (sourceDirectory: string, source: string): string =>
  relative(sourceDirectory, source).replaceAll("\\", "/");

const buildBundle = async (
  sourceDirectory: string,
  files: readonly string[],
): Promise<string> => {
  const sections = await Promise.all(
    files
      .filter((file) => !isMetadataFile(file))
      .map(async (source) => {
        const content = await readFile(source, "utf8");
        return `========${sourceName(sourceDirectory, source)}=====\n${content}`;
      }),
  );
  return `${sections.join("\n\n")}\n`;
};

const writeBundle = async (
  destinationDirectory: string,
  content: string,
): Promise<void> => {
  await mkdir(destinationDirectory, { recursive: true });
  await writeFile(join(destinationDirectory, "xyops.md"), content, "utf8");
};

const printPlan = (
  destinationDirectory: string,
  sourceCount: number,
  bundledCount: number,
): void => {
  console.log(
    `${sourceCount} source files collapsed into ${bundledCount} Markdown file: ${join(destinationDirectory, "xyops.md")}`,
  );
};

type Main = (arguments_: readonly string[]) => Promise<void>;
const main: Main = async (arguments_) => {
  const options = parseOptions(arguments_);
  if (!(await isDirectory(options.sourceDirectory)))
    throw new Error(`Source directory does not exist: ${options.sourceDirectory}`);
  const files = await listFiles(options.sourceDirectory);
  const bundle = await buildBundle(options.sourceDirectory, files);
  printPlan(options.destinationDirectory, files.length, 1);
  if (!options.dryRun) await writeBundle(options.destinationDirectory, bundle);
  console.log(options.dryRun ? "Dry run complete." : "Bundle written.");
};

main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
