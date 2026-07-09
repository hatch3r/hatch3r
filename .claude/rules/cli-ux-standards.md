---
id: cli-ux-standards
type: rule
description: Requirements for all CLI code in src/cli/ — actionable errors with HatchError, progressive disclosure, existing UI dependencies only, first-run success on Node 22+, minimized decisions, standard exit codes.
tags: [maintainer, cli, p1]
scope: always
precedence: high
---

# CLI UX Standards

> Last updated: 2026-07-09

**Pillars:** P1 (CLI UX Excellence)

Requirements for all CLI code in `src/cli/`:

1. **Actionable errors:** Every error includes what failed, why, and what the user should do next. Use `HatchError` class with `exitCode`
2. **Progressive disclosure:** Simple output by default, `--verbose` for detail
3. **Existing UI dependencies only:** `ora` (spinners), `chalk` (color), `boxen` (framed output), `inquirer` (prompts). Do not introduce new UI libraries
4. **First-run success:** `npx hatch3r init` must succeed with only Node 22+ installed — no other prerequisites
5. **Minimize decisions:** Reduce prompts per flow. Use smart defaults with override flags
6. **Exit codes:** differentiated per failure kind via `ERROR_CODE_TO_EXIT_CODE` in `src/types.ts` (single source of truth, BSD `sysexits.h` convention): 0 = success / clean user cancel, 2 = usage error (Commander), 64 `VALIDATION_ERROR`, 65 `CONFIG_ERROR`, 69 `ADAPTER_ERROR`, 70 `UNKNOWN_ERROR`, 73 `INTEGRITY_ERROR`, 74 `FS_ERROR`/`CLEAN_ERROR`, 75 `NETWORK_ERROR`/`LOCK_TIMEOUT`, 130 = SIGINT. The published user-facing table lives in `docs/troubleshooting.md` → Exit Codes. CI scripts MUST branch on the exact code, not `[ $? -eq 1 ]` (hatch3r emits no exit 1 for command failures).
7. **Standard flag matrix (2.0.0):** every non-stub command/subcommand registers `--format <human|json>` (normalized via `parseFormatOption` in `src/cli/shared/output.ts`) + `--quiet`; mutating commands register `--dry-run` with a wired preview; `--verbose` is registered only where detail output is actually read — a registered-but-unread flag violates the Silent Failure Contract (CONSTITUTION §2). Command endings flow through `finishCommand()` in `src/cli/shared/commandOutput.ts`: one outcome box + ≤3 next-steps in human mode, or exactly one JSON envelope (`status`, payload fields, `command`, `hatch3rVersion`, `timestamp`) on stdout in JSON mode — never both. `--format json` on a prompting invocation without `--yes` is an exit-2 usage error (`beginCommand` rejects before any UI flag mutates). Drift guard: the "W5 flag-surface drift guard" suite in `src/__tests__/cli/index.test.ts` fails when a new registration is not classified into the matrix.

Audit checklist: `governance/audit/domains/D10-documentation-devex.md`
