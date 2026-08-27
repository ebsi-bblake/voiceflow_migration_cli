import { runNativePlugin } from "./process_entrypoint";
import { formatPluginDiagnostic } from "./diagnostics";

type ReportProcessFailure = (error: unknown) => void;
const reportProcessFailure: ReportProcessFailure = (error) => {
  process.stderr.write(`${formatPluginDiagnostic("response", error)}\n`);
  process.exitCode = 1;
};

runNativePlugin(
  process.stdin,
  process.stdout,
  process.env,
  undefined,
  process.stderr,
).catch(reportProcessFailure);
