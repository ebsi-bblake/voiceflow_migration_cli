import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

type FlattenOptions = Readonly<{
  sourceDirectory: string;
  destinationDirectory: string;
  dryRun: boolean;
}>;

type FilePlan = Readonly<{
  source: string;
  destination: string;
}>;

const defaultSourceDirectory = resolve(process.cwd(), "xyops");
const defaultDestinationDirectory = join(homedir(), "Desktop", "xyops");

const parseOptions = (arguments_: readonly string[]): FlattenOptions => {
  const positional = arguments_.filter((argument) => argument !== "--dry-run");
  return {
    sourceDirectory: resolve(positional[0] ?? defaultSourceDirectory),
    destinationDirectory: resolve(
      positional[1] ?? defaultDestinationDirectory,
    ),
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

const outputName = (sourceDirectory: string, source: string): string => {
  const pathWithoutRoot = relative(sourceDirectory, source);
  const pathParts = pathWithoutRoot.split(/[\\/]/u);
  const fileName = pathParts.at(-1) ?? "";
  const fileStem = extname(fileName) === ".ts"
    ? basename(fileName, ".ts")
    : fileName;
  const parts = [...pathParts.slice(0, -1), fileStem];
  return `${parts.join("_")}.md`;
};

const buildPlan = (
  sourceDirectory: string,
  destinationDirectory: string,
  files: readonly string[],
): readonly FilePlan[] =>
  files.map((source) => ({
    source,
    destination: join(destinationDirectory, outputName(sourceDirectory, source)),
  }));

const assertUniqueDestinations = (plan: readonly FilePlan[]): void => {
  const destinations = plan.map(({ destination }) => destination);
  const duplicates = destinations.filter(
    (destination, index) => destinations.indexOf(destination) !== index,
  );
  if (duplicates.length > 0)
    throw new Error(`Flattening creates duplicate output names: ${duplicates.join(", ")}`);
};

const copyPlan = async (plan: readonly FilePlan[]): Promise<void> => {
  await Promise.all(
    plan.map(async ({ source, destination }) => {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }),
  );
};

const printPlan = (plan: readonly FilePlan[]): void => {
  for (const { source, destination } of plan)
    console.log(`${source} -> ${destination}`);
};

type Main = (arguments_: readonly string[]) => Promise<void>;
const main: Main = async (arguments_) => {
  const options = parseOptions(arguments_);
  if (!(await isDirectory(options.sourceDirectory)))
    throw new Error(`Source directory does not exist: ${options.sourceDirectory}`);
  const files = await listFiles(options.sourceDirectory);
  const plan = buildPlan(
    options.sourceDirectory,
    options.destinationDirectory,
    files,
  );
  assertUniqueDestinations(plan);
  printPlan(plan);
  if (!options.dryRun) await copyPlan(plan);
  console.log(
    options.dryRun
      ? `Dry run complete: ${plan.length} files planned.`
      : `Copied ${plan.length} files to ${options.destinationDirectory}.`,
  );
};

main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
