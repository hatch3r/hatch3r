import { verbose } from "../cli/shared/ui.js";

export function recordArchiveProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`archive: ${operation} — ${message}`);
}
