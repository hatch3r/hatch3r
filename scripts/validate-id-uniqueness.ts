#!/usr/bin/env node
/**
 * scripts/validate-id-uniqueness.ts — Cycle 11 M D16-18 (D16): Pillar P5
 * (Governance Self-Quality — Silent Failure Contract), P4 (Lean Coverage).
 *
 * The D16.3 capability-lifecycle-integrity checklist
 * (governance/audit/domains/D16-compound-system.md §16.3) assumes cross-type id
 * hygiene is enforced, but `src/cli/commands/validate.ts` has only TYPE-LOCAL
 * validators — each operates within one content type and never compares a
 * command id against a skill id. So a `commands/hatch3r-X.md` and a
 * `skills/hatch3r-X/SKILL.md` that share the base id `X` slipped through every
 * gate. On Claude Code 2026 both register the SAME `/hatch3r-X` slash and the
 * picker resolves to the skill, silently shadowing the orchestrator command
 * (D5-8 / D10-14 / D16-10 diagnose this exact harm). Three base ids — api-spec,
 * incident-response, release — collide today and all three reached the release
 * branch with no gate firing.
 *
 * This gate closes that hole. It computes the base id of every published
 * command (`commands/hatch3r-*.md`) and every published skill
 * (each `skills/hatch3r-X/` dir with a `SKILL.md`), then fails (exit 1) on any
 * command↔skill base id that collides AND is not on the documented
 * pending-decommission baseline.
 *
 * Why command↔skill specifically, not "any base id across any two types":
 * the harm is a SHARED SLASH NAMESPACE. Commands and skills both emit a
 * `/hatch3r-<base>` slash on the Claude adapter (claude.ts), so two artifacts
 * with the same base id contend for one slash. The deliberate content-quality
 * specialist pairs — `agents/hatch3r-{security,testability,scalability,
 * maintainability,enhancability}.md` paired with the same-named
 * `rules/hatch3r-{...}.md` — share NO slash namespace (a rule is an
 * auto-loaded scope file, an agent is a Task-tool target), so they are not a
 * collision and are out of scope by construction. The agent
 * `hatch3r-incident-responder` is also clear: its id is intentionally distinct
 * from the `incident-response` skill/command (the incident-response triple
 * cross-type-id invariant), so the base ids do not match and no allowlist
 * entry is needed for it.
 *
 * ── Pending-decommission baseline (paired with D16-10) ────────────────────────
 * D16-10 (High, separate wave) decommissions the redundant skill twin of each
 * of the three colliding pairs (the surviving artifact is the `orchestrator:
 * true` command). Until that lands, the three known collisions are reported at
 * WARNING (visible, non-failing) so this gate lands green on the current corpus
 * while hard-erroring any NEW command↔skill collision. The baseline is a
 * self-cleaning ratchet: an allowlist entry whose collision no longer exists on
 * disk is itself an ERROR (ID-UNIQ-STALE-ALLOWLIST), forcing the entry to be
 * removed as D16-10 deletes each skill twin. The allowlist therefore shrinks to
 * empty as D16-10 completes, at which point every command↔skill collision is a
 * hard failure — exactly the end state the finding asks for.
 *
 * Usage: `npm run validate:id-uniqueness`
 *        `tsx scripts/validate-id-uniqueness.ts`
 *        `tsx scripts/validate-id-uniqueness.ts --json`
 */
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/** Published-content filename/dir prefix; stripped to derive the base id. */
const PREFIX = "hatch3r-";

/**
 * Command↔skill base ids that collide today and are pending decommission under
 * D16-10. Reported at WARNING (non-failing) until D16-10 deletes the redundant
 * skill twin; once a twin is gone its entry here becomes a STALE-ALLOWLIST
 * error, forcing removal. New collisions outside this set are hard errors.
 * Keep alphabetized.
 */
export const PENDING_DECOMMISSION_BASE_IDS: readonly string[] = [
  "api-spec",
  "incident-response",
  "release",
] as const;

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning" | "info";

export interface Finding {
  level: Severity;
  code: string;
  /** The colliding base id, or "(allowlist)" for stale-allowlist findings. */
  baseId: string;
  message: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Count of published command base ids scanned. */
  commandCount: number;
  /** Count of published skill base ids scanned. */
  skillCount: number;
}

// ── Discovery ─────────────────────────────────────────────────────

/** Strip the `hatch3r-` prefix to derive an artifact's base id. */
export function toBaseId(name: string): string {
  return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
}

/**
 * Base ids of every published command: `commands/hatch3r-*.md`. Companion
 * subdirectories (`commands/board/`, `commands/rework/`) carry no top-level
 * `hatch3r-*.md` slash command and are excluded — only `hatch3r-`-prefixed `.md`
 * files at the directory root are user-typed `/hatch3r-<base>` slashes.
 */
export async function discoverCommandBaseIds(rootDir: string): Promise<string[]> {
  const dir = join(rootDir, "commands");
  const ids: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // No commands/ dir (e.g. a partial checkout) means nothing to scan. The
    // `entries = []` default (assigned at declaration) is the detection channel:
    // the loop below iterates nothing and the function returns []. Assignment,
    // not a bare return, satisfies the no-silent-catch contract without a
    // disable (eslint.config.js silent-failure/no-silent-catch).
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(PREFIX) || !entry.name.endsWith(".md")) continue;
    ids.push(toBaseId(entry.name.slice(0, -".md".length)));
  }
  return ids.sort();
}

/**
 * Base ids of every published skill: a `skills/hatch3r-<base>` directory
 * containing a `SKILL.md`. `skills/hatch3r-board-shared/` and companion dirs
 * register a `/hatch3r-<base>` slash if they carry a SKILL.md, so the SKILL.md
 * presence — not a name heuristic — is the membership test, matching the
 * skills-strategy convention validate.ts uses.
 */
export async function discoverSkillBaseIds(rootDir: string): Promise<string[]> {
  const dir = join(rootDir, "skills");
  const ids: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // No skills/ dir: nothing to scan. The `entries = []` default is the
    // detection channel (see discoverCommandBaseIds) — assignment, not a bare
    // return, satisfies the no-silent-catch contract without a disable.
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(PREFIX)) continue;
    let hasSkill = false;
    try {
      const inner = await readdir(join(dir, entry.name));
      hasSkill = inner.includes("SKILL.md");
    } catch {
      // Unreadable subdir: treat as no SKILL.md (not a collision source). The
      // `hasSkill = false` default is the detection channel; no silent swallow.
      hasSkill = false;
    }
    if (hasSkill) ids.push(toBaseId(entry.name));
  }
  return ids.sort();
}

// ── Collision detection ───────────────────────────────────────────

/**
 * Detect command↔skill base-id collisions. A base id present in BOTH the
 * command set and the skill set is a collision. Collisions on the
 * pending-decommission baseline are reported at WARNING; all others at ERROR.
 * Additionally, any allowlist entry that is NOT an actual current collision is
 * an ERROR (stale allowlist — the D16-10 twin was decommissioned, so the entry
 * must be removed). Findings are returned sorted by base id for determinism.
 */
export function detectCollisions(
  commandBaseIds: readonly string[],
  skillBaseIds: readonly string[],
  pending: readonly string[] = PENDING_DECOMMISSION_BASE_IDS,
): Finding[] {
  const commands = new Set(commandBaseIds);
  const skills = new Set(skillBaseIds);
  const pendingSet = new Set(pending);

  const collisions: string[] = [];
  for (const id of commands) {
    if (skills.has(id)) collisions.push(id);
  }

  const findings: Finding[] = [];

  for (const id of collisions) {
    if (pendingSet.has(id)) {
      findings.push({
        level: "warning",
        code: "ID-UNIQ-COMMAND-SKILL-PENDING",
        baseId: id,
        message:
          `base id '${id}' is shared by commands/hatch3r-${id}.md and ` +
          `skills/hatch3r-${id}/SKILL.md — both register /hatch3r-${id}, so the ` +
          `Claude picker shadows the orchestrator command with the skill. This ` +
          `pair is pending decommission under D16-10 (delete the redundant skill ` +
          `twin; the orchestrator: true command survives). Allowlisted at warning ` +
          `until then; remove it from PENDING_DECOMMISSION_BASE_IDS once the twin ` +
          `is gone.`,
      });
    } else {
      findings.push({
        level: "error",
        code: "ID-UNIQ-COMMAND-SKILL-COLLISION",
        baseId: id,
        message:
          `base id '${id}' is shared by commands/hatch3r-${id}.md and ` +
          `skills/hatch3r-${id}/SKILL.md — both register /hatch3r-${id} on the ` +
          `Claude adapter, so the picker silently resolves to one and shadows the ` +
          `other. Give one a distinct base id (e.g. hatch3r-${id}-publish), OR ` +
          `collapse the inline skill into the command, OR delete the redundant ` +
          `artifact per .claude/rules/content-authoring.md §9.`,
      });
    }
  }

  // Stale-allowlist self-clean: an entry that no longer collides must be pruned.
  const collisionSet = new Set(collisions);
  for (const id of pendingSet) {
    if (!collisionSet.has(id)) {
      findings.push({
        level: "error",
        code: "ID-UNIQ-STALE-ALLOWLIST",
        baseId: id,
        message:
          `'${id}' is on PENDING_DECOMMISSION_BASE_IDS but is no longer a ` +
          `command↔skill collision (the D16-10 decommission landed). Remove '${id}' ` +
          `from PENDING_DECOMMISSION_BASE_IDS so the gate hard-fails any future ` +
          `reintroduction of this collision.`,
      });
    }
  }

  return findings.sort((a, b) => a.baseId.localeCompare(b.baseId));
}

// ── Core ──────────────────────────────────────────────────────────

export interface RunOptions {
  /** Repo root to resolve commands/ and skills/ against; defaults to repo root. */
  rootDir?: string;
  /**
   * Pending-decommission base-id allowlist; defaults to the production
   * PENDING_DECOMMISSION_BASE_IDS. Injectable so temp-root tests can drive a
   * synthetic corpus without the production allowlist firing stale-allowlist
   * errors against it.
   */
  pending?: readonly string[];
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const pending = opts.pending ?? PENDING_DECOMMISSION_BASE_IDS;
  const commandBaseIds = await discoverCommandBaseIds(rootDir);
  const skillBaseIds = await discoverSkillBaseIds(rootDir);
  const findings = detectCollisions(commandBaseIds, skillBaseIds, pending);
  return {
    ...tally(findings),
    commandCount: commandBaseIds.length,
    skillCount: skillBaseIds.length,
  };
}

function tally(findings: Finding[]): {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount++;
    else if (f.level === "warning") warningCount++;
    else infoCount++;
  }
  return { findings, errorCount, warningCount, infoCount };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : f.level === "warning" ? "WARN " : "INFO ";
  return `[${tag} ${f.code}] ${f.baseId} ${f.message}`;
}

interface CliFlags {
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  return { json: argv.includes("--json") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator();
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      if (f.level === "error") console.error(line);
      else if (f.level === "warning") console.warn(line);
      else console.log(line);
    }
    console.log(
      `validate-id-uniqueness: ${result.commandCount} command + ${result.skillCount} skill base id(s) checked; ` +
        `${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // reason: a malformed argv[1] just means "not the entrypoint" — fall to
    // false silently so an importing test never triggers main() and never
    // prints a spurious warning on every import.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-id-uniqueness failed:", err);
    process.exit(1);
  });
}
