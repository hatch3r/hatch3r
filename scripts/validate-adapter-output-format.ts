import type { Finding, RunResult } from "./validate-adapter-output.js";

export function formatFinding(finding: Finding): string {
  const tag = finding.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${finding.code}] ${finding.tool}/${finding.ruleId}: ${finding.message}`;
}

export function wantsJsonOutput(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

export function printRunResult(result: RunResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const finding of result.findings) {
    const line = formatFinding(finding);
    if (finding.level === "error") console.error(line);
    else console.warn(line);
  }
  console.log(
    `validate-adapter-output: ${result.checkedRules} rule(s) × ${result.checkedTools} adapter(s) checked; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
  );
}
