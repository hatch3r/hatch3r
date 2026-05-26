/**
 * D20 user-content authoring backend.
 *
 * Public surface for the `/hatch3r-create` command and `hatch3r-creator`
 * sub-agent. Provides three operations against the project-local
 * `.hatch3r/overrides/` subtree (Wave 5 — relocated from `.agents/user/`):
 *
 *   - {@link saveUserContent}    — strict + gentle gate funnel + atomic write
 *   - {@link discoverUserContent} — enumerate user artifacts on disk
 *   - {@link validateUserArtifact} — gate-only "preview" without writing
 *
 * Strict gates block the save (return `strictFailures` populated, written:
 * []). Gentle gates only warn (return `gentleWarnings`, written populated).
 *
 * Reuses (no reinvention):
 *   - `scanForDeniedPatterns` (src/adapters/customization.ts)
 *   - `sanitizePipelineInput` (src/pipeline/promptGuard.ts)
 *   - `atomicWriteFile`        (src/merge/safeWrite.ts)
 *   - `isValidHookEvent`       (src/hooks/types.ts)
 *   - `cursorCompanionFrontmatter`, `buildContentIndex`, `resolveUserContentRoot`
 *     (src/content/index.ts)
 *   - `readManifest`, `writeManifest` (src/manifest/hatchJson.ts)
 *
 * Pillars served: P4 (Lean Coverage — single-source-of-truth gate funnel),
 * P5 (Governance Self-Quality — strict gates enforce charter), P6 (Security
 * — deny-pattern scan + path-traversal guard + size cap).
 */

import { readdir, mkdir, stat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { scanForDeniedPatterns } from "../adapters/customization.js";
import { sanitizePipelineInput } from "../pipeline/promptGuard.js";
import { isValidHookEvent } from "../hooks/types.js";
import { ALL_TOOL_CATEGORIES } from "../pipeline/agentToolAllowlist.js";
import {
  buildContentIndex,
  cursorCompanionFrontmatter,
  resolveUserContentRoot,
  type ContentIndex,
} from "./index.js";
import { readManifest, writeManifest } from "../manifest/hatchJson.js";

// ── Public types ───────────────────────────────────────────────

export type UserArtifactType = "agent" | "skill" | "rule" | "command" | "hook";

export interface UserContentArtifact {
  type: UserArtifactType;
  /** Kebab-case slug, no `hatch3r-` prefix. */
  name: string;
  /** Description ≥60 characters (strict gate). */
  description: string;
  /** Markdown body (excluding frontmatter). */
  body: string;
  /** Frontmatter overrides — emitted verbatim alongside the derived id/type. */
  frontmatter: Record<string, unknown>;
  /** Optional adapter restriction (empty / omitted = full parity). */
  adapters?: string[];
  /**
   * For type=rule: scope value. This single field is overloaded to encode
   * either a scope keyword (`always` | `conditional`) OR a CSV glob string
   * (e.g. `"src/**\/*.ts,test/**"`). The `.md → .mdc` transform table in
   * `.claude/rules/content-authoring.md` defines how each shape is rendered
   * in the `.mdc` companion. A future iteration may split this into separate
   * `ruleScope` (keyword) + `ruleGlobs` (string[]) fields.
   */
  ruleScope?: string;
  /** For type=rule: precedence bucket. Defaults to `normal` when omitted. */
  rulePrecedence?: "critical" | "high" | "normal" | "low";
  /** For type=hook: lifecycle event from {@link isValidHookEvent}. */
  hookEvent?: string;
  /** For type=command: orchestrator marker. */
  isOrchestrator?: boolean;
  /** For type=command, isOrchestrator=true: list of delegated sub-agents. */
  agentPipeline?: string[];
  /**
   * For type=agent: structured tool allowlist/denylist (C9-H81, D20-F20.1.3).
   *
   * Each entry must be a canonical category from
   * `ALL_TOOL_CATEGORIES` (`src/pipeline/agentToolAllowlist.ts`):
   * `read | search | write | execute | web | mcp | git | board`.
   *
   * Validation rules (strict gate):
   *   - All entries in `allowed` and `denied` must be known categories.
   *   - `allowed` and `denied` may not overlap (no category in both).
   *   - Both arrays may be omitted; an empty `allowed` list is allowed
   *     (the resulting agent has no tool permissions until the user edits
   *     the file manually) but emits a gentle warning.
   *
   * The resulting frontmatter emits as
   * `tools: { allowed: [...], denied: [...] }`. The hatch3r orchestrator
   * checks this declaration against the canonical `AGENT_TOOL_POLICIES`
   * registry at runtime via `checkToolAccess`; the structured shape lets
   * adapters surface the declaration into platform-native runtime guards
   * (Claude PreToolUse hook, Cursor tool-allowlist rule).
   */
  tools?: { allowed?: string[]; denied?: string[] };
}

export interface SaveResult {
  /** Absolute paths written (empty when strict gate failed). */
  written: string[];
  /** Strict-gate failures. Empty when `written.length > 0`. */
  strictFailures: string[];
  /** Gentle-gate warnings. Save proceeds even when populated. */
  gentleWarnings: string[];
}

// ── Constants ──────────────────────────────────────────────────

/** Composed file (frontmatter + body) must fit within this byte cap. */
const MAX_USER_FILE_BYTES = 10_240;

/** Description must be at least this long (strict gate). */
const MIN_DESCRIPTION_LENGTH = 60;

/**
 * Per-type body line thresholds for the gentle "lean" warning (C9-M45,
 * D20-F20.1 lean coverage refinement).
 *
 * Each canonical artifact type has a structural floor below which compression
 * is meaningful — collapsing a 30-line agent prompt loses value, but a
 * 400-line agent prompt has measurable redundancy. The values track the
 * canonical content distribution observed at Cycle 9 baseline:
 *
 *   - agent  (350): chat-style prompts with role + workflow + examples.
 *   - rule   (100): short, declarative, single-pillar enforcement notes.
 *   - skill  (200): Quick Start + step pattern (medium-length prose).
 *   - command (200): orchestrator prompts with pipeline + arg parsing.
 *   - hook   (100): event handlers with terse trigger + action body.
 *
 * Falls back to {@link LEAN_LINE_THRESHOLD_DEFAULT} when the type is not in
 * the map (defensive — every value of {@link UserArtifactType} is keyed).
 */
const LEAN_LINE_THRESHOLDS: Record<UserArtifactType, number> = {
  agent: 350,
  rule: 100,
  skill: 200,
  command: 200,
  hook: 100,
};

/** Fallback used when the artifact type is not in {@link LEAN_LINE_THRESHOLDS}. */
const LEAN_LINE_THRESHOLD_DEFAULT = 120;

/** Slug regex: lowercase kebab-case, must start with [a-z]. */
const SLUG_REGEX = /^[a-z][a-z0-9-]*$/;

/**
 * D20 anti-slop wordlist for the gentle gate. Mirrors the 12-entry list in
 * the implementation plan and the canonical CLAUDE.md banned-phrase table.
 * Case-insensitive substring match — we intentionally err on the side of
 * "warn but save" so authors can override with rationale.
 */
const ANTI_SLOP_WORDLIST: readonly string[] = [
  "best possible",
  "best-in-class",
  "world-class",
  "comprehensive and thorough",
  "exhaustive",
  "robust and resilient",
  "high-quality",
  "ensure",
  "properly",
  "correctly",
  "as needed",
  "scalable",
];

// ── Public API ─────────────────────────────────────────────────

/**
 * Save a user artifact under `.hatch3r/overrides/{type}/...` after running strict
 * + gentle gates. Strict failure short-circuits (no filesystem mutation).
 * Successful save also bumps `hatch.json.userContent` counters when the
 * manifest exists.
 */
export async function saveUserContent(
  rootDir: string,
  artifact: UserContentArtifact,
): Promise<SaveResult> {
  // Build a merged canonical+user index for collision detection. We point
  // the user-root at the same project so the index sees existing user
  // artifacts (helpful for catching duplicate names within the user tree).
  const packageContentRoot = await resolvePackageContentRoot();
  const index = await buildContentIndex(packageContentRoot, {
    userRoot: resolveUserContentRoot(rootDir),
  });

  const { strict, gentle } = await runUserContentGates(artifact, index);
  if (strict.length > 0) {
    return { written: [], strictFailures: strict, gentleWarnings: gentle };
  }

  const written = await writeArtifactFiles(rootDir, artifact);

  // Update hatch.json userContent counters (best-effort: a missing manifest
  // is not a save failure — init may not have run yet).
  await tryUpdateManifestCounters(rootDir, artifact.type);

  return { written, strictFailures: [], gentleWarnings: gentle };
}

/**
 * Enumerate artifacts under `.hatch3r/overrides/`. Returns an empty list when the
 * user subtree does not exist yet.
 *
 * For agents/commands/rules/hooks we glob `*.md` (skipping `.mdc` companions
 * — they pair with their `.md` siblings, never standalone). For skills we
 * scan each `<name>/SKILL.md` subdirectory.
 */
export async function discoverUserContent(
  rootDir: string,
): Promise<{ type: UserArtifactType; name: string; path: string }[]> {
  const userRoot = resolveUserContentRoot(rootDir);
  try {
    await stat(userRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const out: { type: UserArtifactType; name: string; path: string }[] = [];

  for (const type of ["agent", "skill", "rule", "command", "hook"] as const) {
    const dir = userTypeDir(userRoot, type);
    if (type === "skill") {
      let dirents: { name: string; isDirectory: () => boolean }[];
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      for (const d of dirents) {
        if (!d.isDirectory()) continue;
        const skillFile = join(dir, d.name, "SKILL.md");
        try {
          await stat(skillFile);
          out.push({ type, name: d.name, path: skillFile });
        } catch (err) {
          // ENOENT is expected for in-progress / orphaned skill dirs.
          // Surface other errors so they don't disappear into silence.
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.warn(
              `[hatch3r] discoverUserContent: cannot stat ${skillFile}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    } else {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      for (const f of entries) {
        if (!f.endsWith(".md")) continue;
        const name = f.replace(/\.md$/, "");
        out.push({ type, name, path: join(dir, f) });
      }
    }
  }

  return out;
}

/**
 * Run only the strict + gentle gates against an artifact (no write).
 * Useful for "preview" UX before committing the save.
 */
export async function validateUserArtifact(
  artifact: UserContentArtifact,
  index: ContentIndex,
): Promise<{ strict: string[]; gentle: string[] }> {
  return runUserContentGates(artifact, index);
}

// ── Public API: pre-flight body validation (C9-H84) ────────────

/**
 * Per-file violation surfaced by {@link validateContentBody}.
 */
export interface ContentBodyViolation {
  /** Project-relative path of the offending file (e.g. `.hatch3r/overrides/agents/foo.md`). */
  relativePath: string;
  /** Severity bucket — strict failures must block `sync`; warnings are advisory. */
  severity: "error" | "warning";
  /** Human-readable description of the violation. */
  message: string;
}

/**
 * Scan body content of canonical artifacts AND `.hatch3r/overrides/` artifacts via
 * `scanForDeniedPatterns` + `sanitizePipelineInput` before they are forwarded
 * into adapter outputs. Used by `sync` as a pre-flight gate so a tampered or
 * prompt-injected user artifact cannot ride into `.cursor/`, `.claude/`, etc.
 *
 * Cross-links D15-SA15.1-F04 (ContentValidator pattern) with D20-F20.2.2
 * (closes CD-10 partial). The scan is read-only — it returns violations and
 * leaves all on-disk state untouched.
 *
 * Behavior:
 *   - Returns an empty list when `.hatch3r/overrides/` does not exist.
 *   - Treats deny-pattern hits and injection-scan violations as `severity: "error"`.
 *   - Reads the file body (post-frontmatter) and surfaces every match.
 *   - Tolerates I/O errors on individual files (logs a warning entry, continues
 *     scanning siblings) — a malformed user file never halts the pre-flight.
 */
export async function validateContentBody(
  rootDir: string,
): Promise<ContentBodyViolation[]> {
  const violations: ContentBodyViolation[] = [];
  const userArtifacts = await discoverUserContent(rootDir);
  if (userArtifacts.length === 0) return violations;

  for (const artifact of userArtifacts) {
    const relativePath = relativizeUnderRoot(rootDir, artifact.path);

    let raw: string;
    try {
      raw = await readFile(artifact.path, "utf-8");
    } catch (err) {
      violations.push({
        relativePath,
        severity: "warning",
        message: `unreadable: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const body = stripFrontmatter(raw);

    // Strict: deny-pattern scan on body.
    for (const hit of scanForDeniedPatterns(body)) {
      violations.push({
        relativePath,
        severity: "error",
        message: `body contains denied pattern — ${hit}`,
      });
    }

    // Strict: pipeline injection scan on body.
    const sanitized = sanitizePipelineInput(body);
    for (const v of sanitized.violations) {
      violations.push({
        relativePath,
        severity: "error",
        message: `body fails injection scan — ${v}`,
      });
    }
    if (sanitized.truncated && sanitized.violations.length === 0) {
      violations.push({
        relativePath,
        severity: "error",
        message: "body exceeds pipeline input cap and was truncated by sanitizePipelineInput",
      });
    }
  }

  return violations;
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("---", 3);
  if (end === -1) return raw;
  return raw.slice(end + 3).replace(/^\n/, "");
}

function relativizeUnderRoot(rootDir: string, absPath: string): string {
  // Normalize separators and trim a leading "./". sync/validate consumers
  // print this label verbatim so we keep it forward-slash-normalized.
  const normRoot = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
  if (absPath.startsWith(normRoot)) {
    return absPath.slice(normRoot.length);
  }
  return absPath;
}

// ── Internal: gate funnel ──────────────────────────────────────

async function runUserContentGates(
  artifact: UserContentArtifact,
  index: ContentIndex,
): Promise<{ strict: string[]; gentle: string[] }> {
  const strict: string[] = [];

  // 1. Frontmatter schema — slug, type, description.
  if (!SLUG_REGEX.test(artifact.name)) {
    strict.push(
      `Invalid name "${artifact.name}": must match ${SLUG_REGEX.source} (lowercase kebab-case, start with [a-z])`,
    );
  }
  if (artifact.name.startsWith("hatch3r-")) {
    strict.push(
      `Invalid name "${artifact.name}": must NOT start with "hatch3r-" (reserved for canonical artifacts)`,
    );
  }
  if (!["agent", "skill", "rule", "command", "hook"].includes(artifact.type)) {
    strict.push(`Invalid type "${artifact.type}": expected agent|skill|rule|command|hook`);
  }
  if (typeof artifact.description !== "string" || artifact.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    strict.push(
      `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters (got ${artifact.description?.trim().length ?? 0})`,
    );
  }

  // 2. Path-traversal guard on the slug. Belt-and-suspenders to the regex.
  if (
    artifact.name.includes("/") ||
    artifact.name.includes("\\") ||
    artifact.name.includes("..") ||
    artifact.name.includes("\0")
  ) {
    strict.push(
      `Invalid name "${artifact.name}": must not contain path separators, "..", or null bytes`,
    );
  }

  // 3. ID collision against canonical (and existing user content).
  const expectedId =
    artifact.type === "command"
      ? `cmd-hatch3r-${artifact.name}`
      : `hatch3r-${artifact.name}`;
  // The user's chosen *unprefixed* id is what they will see in adapter
  // output. Compare both forms against the canonical index so that, e.g.,
  // user "implementer" cannot shadow canonical "hatch3r-implementer".
  for (const candidate of [artifact.name, expectedId]) {
    if (index.byId.has(candidate)) {
      const hit = index.byId.get(candidate);
      if (hit && hit.source === "canonical") {
        strict.push(
          `ID "${candidate}" collides with canonical ${hit.type} at ${hit.relativePath} — choose a different name`,
        );
      }
    }
  }
  // Same-tree collision (existing user artifact with the same name).
  for (const item of index.items) {
    if (item.source !== "user") continue;
    if (item.type !== artifact.type) continue;
    // user items keep the unprefixed id (no hatch3r- prefix on disk)
    const itemBase = item.id.replace(/^cmd-/, "");
    if (itemBase === artifact.name) {
      strict.push(
        `User artifact "${artifact.name}" already exists at ${item.relativePath} — delete it first or choose a different name`,
      );
    }
  }

  // 4. Deny-pattern scan: body + every string-valued frontmatter entry.
  const denyHits = scanForDeniedPatterns(artifact.body);
  for (const hit of denyHits) {
    strict.push(`Body content rejected: ${hit}`);
  }
  for (const [k, v] of Object.entries(artifact.frontmatter ?? {})) {
    if (typeof v === "string") {
      const fmHits = scanForDeniedPatterns(v);
      for (const hit of fmHits) {
        strict.push(`Frontmatter "${k}" rejected: ${hit}`);
      }
    }
  }

  // 5. Pipeline-injection scan via sanitizePipelineInput. Any violation OR
  // a truncation result is a strict failure (the user's body is being
  // transmitted verbatim into the adapter pipeline; we do not silently
  // truncate).
  const sanitized = sanitizePipelineInput(artifact.body);
  for (const v of sanitized.violations) {
    strict.push(`Body fails injection scan: ${v}`);
  }
  if (sanitized.truncated && sanitized.violations.length === 0) {
    // Belt-and-suspenders: the size gate (step 7) will also reject anything
    // over 10KB, but a truncation here means the body alone exceeded
    // sanitizePipelineInput's 500KB ceiling — surface explicitly.
    strict.push("Body exceeds the pipeline input length cap and was truncated by sanitizePipelineInput");
  }

  // 6. Type-specific contracts.
  if (artifact.type === "command") {
    if (artifact.isOrchestrator === true) {
      if (!Array.isArray(artifact.agentPipeline) || artifact.agentPipeline.length === 0) {
        strict.push(
          "Orchestrator commands must declare a non-empty agentPipeline (list of delegated sub-agent IDs)",
        );
      }
    }
  }
  if (artifact.type === "hook") {
    if (!artifact.hookEvent || !isValidHookEvent(artifact.hookEvent)) {
      strict.push(
        `Hook event missing or invalid: expected one of pre-commit, post-merge, ci-failure, file-save, session-start, pre-push, worktree-create, worktree-remove (got ${JSON.stringify(artifact.hookEvent)})`,
      );
    }
  }
  // For type=rule, the .mdc companion is generated deterministically from
  // ruleScope. There is no failure mode at gate time — derivation always
  // produces a valid frontmatter. The companion is written alongside the
  // .md by writeArtifactFiles().

  // 7. File size cap on the composed payload.
  const composed = composeArtifactFile(artifact);
  if (Buffer.byteLength(composed, "utf-8") > MAX_USER_FILE_BYTES) {
    strict.push(
      `Composed file exceeds size cap of ${MAX_USER_FILE_BYTES} bytes — split the artifact or remove non-essential body content`,
    );
  }

  // ── Gentle gates (warn but save) ────────────────────────────
  const gentle: string[] = [];

  // Anti-slop wordlist scan over body + frontmatter description.
  const lowerBody = artifact.body.toLowerCase();
  for (const phrase of ANTI_SLOP_WORDLIST) {
    if (lowerBody.includes(phrase)) {
      gentle.push(
        `Anti-slop phrase '${phrase}' detected — replace with measurable criterion`,
      );
    }
  }
  if (typeof artifact.description === "string") {
    const lowerDesc = artifact.description.toLowerCase();
    for (const phrase of ANTI_SLOP_WORDLIST) {
      if (lowerDesc.includes(phrase)) {
        gentle.push(
          `Anti-slop phrase '${phrase}' detected in description — replace with measurable criterion`,
        );
      }
    }
  }

  // Lean line threshold (per-type, C9-M45). Falls back to the default cap
  // when the artifact type is missing from the registry — defensive only;
  // every value of UserArtifactType is keyed.
  const lineCount = artifact.body.split(/\r?\n/).length;
  const typedThreshold =
    LEAN_LINE_THRESHOLDS[artifact.type] ?? LEAN_LINE_THRESHOLD_DEFAULT;
  if (lineCount > typedThreshold) {
    gentle.push(
      `Body has ${lineCount} lines (lean threshold for ${artifact.type}: ${typedThreshold}) — consider compressing`,
    );
  }

  const fm = artifact.frontmatter ?? {};

  // ── Promoted strict gates (C9-H79, C9-H80) ─────────────────
  // CD-12: charter inheritance and pillar declaration are promoted from
  // gentle to strict per D20-F20.1.1 / D20-F20.1.2 — Critical-on-absence is
  // the closed-loop disposition. Authors must declare which pillar a user
  // artifact serves and inherit the charter discipline; missing either is a
  // governance regression at the user-content tier.

  // quality_charter reference (strict).
  if (!("quality_charter" in fm) && !/quality[_-]charter/i.test(artifact.body)) {
    strict.push(
      "Missing quality_charter reference — add `quality_charter: agents/shared/quality-charter.md` to frontmatter or reference it in the body",
    );
  }

  // Pillar declaration (strict).
  const hasPillarFm = Array.isArray(fm.pillars) && fm.pillars.length > 0;
  const hasPillarBody = /(^|\n)\s*##\s*Pillar/i.test(artifact.body) ||
    /\*\*Pillars?:\*\*/i.test(artifact.body);
  if (!hasPillarFm && !hasPillarBody) {
    strict.push(
      "Missing pillar declaration — add `pillars: [P1...P6]` to frontmatter or a `**Pillars:**` line in the body",
    );
  }

  // ── Structured tools field (C9-H81, D20-F20.1.3) ───────────────
  // Validate `tools.allowed` / `tools.denied` (when present) against the
  // canonical category registry exported by `agentToolAllowlist.ts`. The
  // shape lets the input contract carry an explicit allowlist/denylist
  // for agent artifacts so adapter outputs (Claude PreToolUse hook,
  // Cursor tool-allowlist rule) can mirror the declaration at runtime.
  if (artifact.tools !== undefined) {
    const toolsViolations = validateStructuredTools(artifact.tools);
    for (const v of toolsViolations) strict.push(v);
  }

  return { strict, gentle };
}

/**
 * Validate the structured `tools` field per C9-H81 / D20-F20.1.3.
 *
 * Returns a list of strict-gate failure messages. An empty list means
 * the field passes every check (or was absent — callers gate the call
 * on `artifact.tools !== undefined`).
 *
 * Checks enforced:
 *   1. `tools` is a plain object (rejects arrays, strings, etc.).
 *   2. `tools.allowed` and `tools.denied`, when present, are arrays of
 *      strings.
 *   3. Every entry resolves to a canonical category from
 *      `ALL_TOOL_CATEGORIES` (the same registry used by
 *      `checkToolAccess` and the adapter-emitted hooks).
 *   4. No category appears in both `allowed` and `denied` (contradictory
 *      declaration).
 *
 * Empty arrays are tolerated by the strict gate — the gentle layer can
 * still nudge the author, but a deliberately empty allowlist is a valid
 * configuration (locks the agent out of every tool until the user
 * edits the file manually).
 */
function validateStructuredTools(
  tools: NonNullable<UserContentArtifact["tools"]>,
): string[] {
  const violations: string[] = [];

  if (typeof tools !== "object" || tools === null || Array.isArray(tools)) {
    return [
      "Invalid `tools` field — expected an object of shape { allowed?: string[], denied?: string[] }",
    ];
  }

  const known = new Set<string>(ALL_TOOL_CATEGORIES);

  const checkList = (
    list: unknown,
    label: "allowed" | "denied",
  ): string[] | undefined => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) {
      violations.push(
        `Invalid \`tools.${label}\` — expected an array of category strings (got ${typeof list})`,
      );
      return undefined;
    }
    const cleaned: string[] = [];
    for (const entry of list) {
      if (typeof entry !== "string") {
        violations.push(
          `Invalid \`tools.${label}\` entry — every entry must be a string (got ${typeof entry})`,
        );
        continue;
      }
      if (!known.has(entry)) {
        violations.push(
          `Unknown tool category "${entry}" in \`tools.${label}\` — valid categories: ${ALL_TOOL_CATEGORIES.join(", ")}`,
        );
        continue;
      }
      cleaned.push(entry);
    }
    return cleaned;
  };

  const allowed = checkList(tools.allowed, "allowed");
  const denied = checkList(tools.denied, "denied");

  if (allowed && denied) {
    const allowedSet = new Set(allowed);
    const overlap = denied.filter((c) => allowedSet.has(c));
    if (overlap.length > 0) {
      violations.push(
        `Contradictory \`tools\` declaration — categories appear in both allowed and denied: ${overlap.join(", ")}`,
      );
    }
  }

  return violations;
}

// ── Internal: composition + write ──────────────────────────────

/**
 * Compose the on-disk file content (frontmatter + body) for an artifact.
 * Used both for the size gate and for the actual write.
 */
function composeArtifactFile(artifact: UserContentArtifact): string {
  // Build the canonical frontmatter object, merging user-supplied
  // frontmatter on top of the derived defaults. User keys win — except
  // `id`, `type`, `description`, `name` which we set authoritatively from
  // the artifact's typed fields so a malformed frontmatter cannot
  // misrepresent the artifact's identity.
  // Merge user frontmatter first, then re-pin the authoritative identity
  // keys so a malformed user frontmatter cannot impersonate another id /
  // type / description.
  const derived: Record<string, unknown> = {
    name: artifact.name,
    ...artifact.frontmatter,
  };
  derived.id = artifact.name;
  derived.type = artifact.type;
  derived.description = artifact.description;
  if (artifact.adapters && artifact.adapters.length > 0) {
    derived.adapters = artifact.adapters;
  }
  if (artifact.type === "rule" && artifact.ruleScope !== undefined) {
    derived.scope = artifact.ruleScope;
  }
  if (artifact.type === "rule" && artifact.rulePrecedence) {
    derived.precedence = artifact.rulePrecedence;
  }
  if (artifact.type === "hook" && artifact.hookEvent) {
    derived.event = artifact.hookEvent;
  }
  if (artifact.type === "command") {
    if (artifact.isOrchestrator !== undefined) {
      derived.orchestrator = artifact.isOrchestrator;
    }
    if (artifact.isOrchestrator && artifact.agentPipeline) {
      derived.agentPipeline = artifact.agentPipeline;
    }
  }
  // Emit the structured `tools` field when present (C9-H81). The strict
  // gate already validated the shape and category membership; here we
  // simply serialise the trimmed payload — both keys are optional, and
  // we only include each side when the author supplied it.
  if (artifact.tools && typeof artifact.tools === "object" && !Array.isArray(artifact.tools)) {
    const toolsPayload: { allowed?: string[]; denied?: string[] } = {};
    if (Array.isArray(artifact.tools.allowed)) {
      toolsPayload.allowed = [...artifact.tools.allowed];
    }
    if (Array.isArray(artifact.tools.denied)) {
      toolsPayload.denied = [...artifact.tools.denied];
    }
    if (toolsPayload.allowed !== undefined || toolsPayload.denied !== undefined) {
      derived.tools = toolsPayload;
    }
  }

  const yaml = yamlStringify(derived).trim();
  // yaml's stringify emits trailing newline-free output; we wrap with
  // `---` fences and ensure a single blank line between frontmatter and
  // body.
  const body = artifact.body.startsWith("\n") ? artifact.body : `\n${artifact.body}`;
  return `---\n${yaml}\n---\n${body}`;
}

/**
 * Write the artifact files to disk via {@link atomicWriteFile}. For rules,
 * also emits the paired `.mdc` companion using
 * {@link cursorCompanionFrontmatter}.
 */
async function writeArtifactFiles(
  rootDir: string,
  artifact: UserContentArtifact,
): Promise<string[]> {
  const userRoot = resolveUserContentRoot(rootDir);
  const written: string[] = [];
  const composed = composeArtifactFile(artifact);

  switch (artifact.type) {
    case "agent": {
      const dir = userTypeDir(userRoot, "agent");
      await mkdir(dir, { recursive: true });
      const target = join(dir, `${artifact.name}.md`);
      await atomicWriteFile(target, composed);
      written.push(target);
      break;
    }
    case "skill": {
      const dir = userTypeDir(userRoot, "skill");
      const skillDir = join(dir, artifact.name);
      await mkdir(skillDir, { recursive: true });
      const target = join(skillDir, "SKILL.md");
      await atomicWriteFile(target, composed);
      written.push(target);
      break;
    }
    case "rule": {
      const dir = userTypeDir(userRoot, "rule");
      await mkdir(dir, { recursive: true });
      const mdTarget = join(dir, `${artifact.name}.md`);
      await atomicWriteFile(mdTarget, composed);
      written.push(mdTarget);
      // Generate paired .mdc companion via the canonical helper.
      const mdcFrontmatter = cursorCompanionFrontmatter(
        artifact.description,
        artifact.ruleScope,
      );
      const mdcContent = `${mdcFrontmatter}\n${artifact.body.startsWith("\n") ? artifact.body : `\n${artifact.body}`}`;
      const mdcTarget = join(dir, `${artifact.name}.mdc`);
      await atomicWriteFile(mdcTarget, mdcContent);
      written.push(mdcTarget);
      break;
    }
    case "command": {
      const dir = userTypeDir(userRoot, "command");
      await mkdir(dir, { recursive: true });
      const target = join(dir, `${artifact.name}.md`);
      await atomicWriteFile(target, composed);
      written.push(target);
      break;
    }
    case "hook": {
      const dir = userTypeDir(userRoot, "hook");
      await mkdir(dir, { recursive: true });
      const target = join(dir, `${artifact.name}.md`);
      await atomicWriteFile(target, composed);
      written.push(target);
      break;
    }
  }

  return written;
}

// ── Internal: helpers ──────────────────────────────────────────

function userTypeDir(userRoot: string, type: UserArtifactType): string {
  // `.hatch3r/overrides/{plural-dir}` mirrors canonical content layout.
  const plural: Record<UserArtifactType, string> = {
    agent: "agents",
    skill: "skills",
    rule: "rules",
    command: "commands",
    hook: "hooks",
  };
  return join(userRoot, plural[type]);
}

/**
 * Best-effort manifest counter update. Reads `.hatch3r/hatch.json` (returns
 * null when absent), computes new counters from `discoverUserContent`, and
 * writes the manifest back atomically. If the manifest does not exist yet
 * (init has not run), this is a silent no-op so the save still succeeds.
 *
 * Wrapped in try/catch so a malformed manifest does not break the save —
 * the artifact landed on disk; counter accuracy is secondary.
 */
async function tryUpdateManifestCounters(
  rootDir: string,
  newType: UserArtifactType,
): Promise<void> {
  let manifest;
  try {
    manifest = await readManifest(rootDir);
  } catch (err) {
    // Malformed manifest — skip counter update. The artifact is already
    // safely on disk; validate.ts will surface the manifest issue. Emit a
    // diagnostic per the Silent Failure Contract so operators see the skip.
    console.warn(
      `[hatch3r] saveUserContent: skipped hatch.json counter bump (manifest unreadable): ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (!manifest) return;

  // Re-scan to keep the count truthful even if the user removed files
  // out-of-band.
  const all = await discoverUserContent(rootDir);
  const types: Record<string, number> = {};
  for (const entry of all) {
    types[entry.type] = (types[entry.type] ?? 0) + 1;
  }
  // Ensure the just-saved type bumps even when the rescan races (atomic
  // rename should be visible, but cover the edge case explicitly).
  if (!(newType in types)) {
    types[newType] = 1;
  }

  manifest.userContent = {
    count: all.length,
    lastModified: new Date().toISOString(),
    types,
  };

  try {
    await writeManifest(rootDir, manifest);
  } catch (err) {
    // Manifest write failed (rare — we just preserved its shape). Skip
    // rather than fail the save, but surface the diagnostic.
    console.warn(
      `[hatch3r] saveUserContent: hatch.json counter bump failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Locate the package's canonical content root. The build emits dist/ next
 * to the package root; canonical content lives at the package root (e.g.
 * `agents/`, `skills/`, `rules/`). When called from the test harness or a
 * non-installed environment we fall back to the repo root by walking up
 * from this file's location.
 */
async function resolvePackageContentRoot(): Promise<string> {
  // The CLI command flow always passes the resolved root through
  // explicitly, but `saveUserContent` is called from sub-agent flows that
  // do not have direct access to it. Resolve relative to the running file
  // so dev and installed-package flows both work.
  //
  // import.meta.url: file:///.../dist/content/userContent.js (installed)
  //                  file:///.../src/content/userContent.ts (test)
  //
  // Use fileURLToPath rather than URL.pathname because on Windows the
  // pathname is `/D:/...` (leading slash before drive letter), which is
  // not a valid Windows path and breaks subsequent `fs` reads. fileURLToPath
  // returns proper platform-native paths.
  const filePath = fileURLToPath(import.meta.url);
  // Walk up: .../{src|dist}/content/userContent.{ts|js} → package root
  // (three parent levels above the file).
  return dirname(dirname(dirname(filePath)));
}
