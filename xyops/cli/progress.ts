type ProgressTask<T> = () => Promise<T>;

type ProgressReporter = {
  readonly run: <T>(label: string, task: ProgressTask<T>) => Promise<T>;
};

const BAR_WIDTH = 20;
const TICK_MS = 200;

const progressLine = (label: string, tick: number): string => {
  const filled = tick % (BAR_WIDTH + 1);
  const bar = `${"#".repeat(filled)}${"_".repeat(BAR_WIDTH - filled)}`;
  return `${label} [${bar}]`;
};

const createProgressReporter = (): ProgressReporter => ({
  run: <T>(label: string, task: ProgressTask<T>): Promise<T> => {
    if (!process.stderr.isTTY) return task();

    let tick = 0;
    const render = (): void => {
      process.stderr.write(`\r${progressLine(label, tick++)}`);
    };
    render();
    const timer = setInterval(render, TICK_MS);
    const finish = (status: "done" | "failed"): void => {
      clearInterval(timer);
      process.stderr.write(`\r${label} [${"#".repeat(BAR_WIDTH)}] ${status}\n`);
    };
    return task().then(
      (result) => {
        finish("done");
        return result;
      },
      (error: unknown) => {
        finish("failed");
        return Promise.reject(error);
      },
    );
  },
});

export const progress = createProgressReporter();
