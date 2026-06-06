/**
 * D1-8 (Cycle 11 Wave 2, P1): resolve the invoked subcommand name from a raw
 * argv, skipping any leading global-flag tokens.
 *
 * The CLI entry point (`src/cli/index.ts`) gates Shift+Tab back-navigation on
 * whether the invoked subcommand is in `BACKABLE_COMMANDS`. Reading a fixed
 * `process.argv[2]` mis-resolves when a global flag is placed before the
 * subcommand — e.g. `hatch3r --no-update-check init` makes `argv[2]` the flag,
 * the BACKABLE check misses `init`, and `registerBackablePrompts()` never
 * fires, silently defeating back-navigation. The `--no-update-check` strip in
 * the entry point runs AFTER the BACKABLE check, so it cannot be relied on to
 * have removed the flag from argv at that point.
 *
 * Skipping leading `-`-prefixed tokens returns the first positional argument —
 * the subcommand — regardless of how many global flags precede it. A bare
 * `hatch3r` (no positional) or a flags-only invocation returns `undefined`,
 * matching the prior `argv[2]`-is-undefined behavior.
 *
 * Side-effect-free (no `process` access) so it unit-tests without executing the
 * CLI — matches the rest of `src/cli/shared/`.
 *
 * @param argv the full process argv array (`[node, script, ...rest]`); the
 *   first two entries are skipped exactly as `process.argv.slice(2)` would.
 * @returns the first non-flag token after the script path, or `undefined`.
 */
export function resolveInvokedCommand(argv: readonly string[]): string | undefined {
  return argv.slice(2).find((arg) => !arg.startsWith("-"));
}
