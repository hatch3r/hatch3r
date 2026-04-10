# CLI UX Standards

P1 (CLI UI/UX Excellence) requirements for all CLI code in `src/cli/`:

1. **Actionable errors:** Every error includes what failed, why, and what the user should do next. Use `HatchError` class with `exitCode`
2. **Progressive disclosure:** Simple output by default, `--verbose` for detail
3. **Existing UI dependencies only:** `ora` (spinners), `chalk` (color), `boxen` (framed output), `inquirer` (prompts). Do not introduce new UI libraries
4. **First-run success:** `npx hatch3r init` must succeed with only Node 22+ installed — no other prerequisites
5. **Minimize decisions:** Reduce prompts per flow. Use smart defaults with override flags
6. **Exit codes:** 0 = success, 1 = unexpected error, 2 = usage error. SIGINT = 130, SIGTERM = 143

Audit checklist: `governance/audit/domains/D10-documentation-devex.md`
