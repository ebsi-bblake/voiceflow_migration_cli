import { failure, type Envelope } from "./vf_contracts";

export type Result = Envelope<unknown>;

export type Runner<T extends Result> = Readonly<{
  run: () => Promise<T>;
  start: () => void;
}>;

type CreateRunner = <T extends Result>(
  operation: string,
  operationRun: () => Promise<T>,
) => Runner<T>;

export const createRunner: CreateRunner = (operation, operationRun) => {
  type Emit = (result: Envelope<unknown>) => void;
  const emit: Emit = (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  };

  type HandleFailure = (error: unknown) => void;
  const handleFailure: HandleFailure = (error) => {
    emit(failure(operation, crypto.randomUUID(), error));
    process.exitCode = 1;
  };

  type Run = typeof operationRun;
  const run: Run = () => Promise.resolve().then(operationRun);

  type Start = () => void;
  const start: Start = () => {
    run().then(emit).catch(handleFailure);
  };

  return { run, start };
};

type RequireEnvironmentValue = (
  name: string,
  value: string | undefined,
) => string;
export const requireEnvironmentValue: RequireEnvironmentValue = (name, value) => {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};
