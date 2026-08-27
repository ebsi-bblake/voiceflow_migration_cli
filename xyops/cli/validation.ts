import { fail } from "./diagnostics";
import { isVoiceflowEnvelope } from "./guards";
import type { ResponseGuard } from "./types";
type RequireEnvelopeResult = <T>(value: unknown, operation: string, resultGuard: ResponseGuard<T>) => T;
export const requireEnvelopeResult: RequireEnvelopeResult = <T>(value: unknown, operation: string, resultGuard: ResponseGuard<T>): T => {
  if (!isVoiceflowEnvelope(resultGuard)(value)) throw fail("envelope", { nextAction: `${operation} returned an invalid response.` });
  if (!value.ok) throw fail("envelope", { nextAction: `${operation} was rejected by the migration runner.` });
  return value.result;
};
