# CLI test-tree placement convention

> Convention record for finding D3-SA3.2-16 (Cycle 12). Placement here is
> organizational, not functional — vitest globs `**/*.test.ts` from both
> directories identically, so a test runs regardless of which one holds it.
> This note states the rule so contributors and reviewers stop guessing.

CLI tests live in two directories:

- **`src/__tests__/cli/*.test.ts` (top level)** holds cross-command and
  entrypoint suites (e.g. `index`, `commander-contract`, `entrypoint`,
  `lifecycle`, `taskRouter`, `errorClassification`) and the original
  per-command suites (e.g. `init`, `clean`, `config`, `sync`, `update`,
  `validate`, `verify`, `status`).

- **`src/__tests__/cli/commands/*.test.ts`** holds the per-command body suites
  added from Cycle-11 finding D3-3 onward (`deps`, `show`, `provenance`,
  `learn`) and later slice-specific suites that cover a single behavior of an
  existing command (e.g. `init.backNav`, `clean.user`, `validate.learnings`,
  `validate.user`).

New-file rule of thumb: a focused suite for one command's body or one of its
behaviors goes under `commands/`; a suite spanning multiple commands or the CLI
entrypoint stays at the top level. Full consolidation onto one scheme is a
future test-tree refactor, not a precondition for adding tests.
