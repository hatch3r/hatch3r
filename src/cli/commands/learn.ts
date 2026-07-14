/**
 * D13-5 (Cycle 11 Wave 2, D13, ASI06): `hatch3r learn capture --file <path>`.
 *
 * Closes the feedback-loop security gap where the mandated learnings write-gate
 * `persistLearning` (`src/content/learningsValidation.ts`) had ZERO non-test
 * callers. `skills/hatch3r-learn/SKILL.md` makes "always route through
 * `persistLearning`" a hard guardrail, but `hatch3r-learn` is an LLM skill with
 * no shell affordance to reach the pipeline — so the agent wrote markdown with a
 * raw `Write`, bypassing the three injection gates (`scanForDeniedPatterns` +
 * `validateAgentOutput` + `sanitizeUserContent`), the in-memory integrity check,
 * and the refuse-overwrite rule (SA13.4-F1).
 *
 * This subcommand is the shell entry point the skill shells out to: it reads the
 * staged learning file the skill authored, verifies the declared body-integrity
 * frontmatter against a recomputed digest, then commits the bytes through
 * `persistLearning` (atomic temp+rename write into `.hatch3r/learnings/`). Any
 * gate rejection prints the reasons and exits 1 fail-closed; nothing is written.
 *
 * Pillar service: P6 (Security & Trust — the documented write-gate is now
 * reachable, so the guardrail is enforced rather than aspirational), P1 (CLI
 * affordance: the skill has a real command to invoke instead of a guardrail it
 * cannot honor).
 */

import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  computeLearningIntegrity,
  DEFAULT_LEARNING_FILE_COUNT,
  persistLearning,
  resolveLearningsCaps,
  validateLearningFileName,
} from "../../content/learningsValidation.js";
import { readManifest } from "../../manifest/hatchJson.js";
import { HatchError, HATCH3R_DIR } from "../../types.js";
import { label, error as logError, verbose, warn } from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";

export interface LearnCaptureOptions {
  /** Absolute or cwd-relative path to the staged learning file to capture. */
  file?: string;
  /**
   * Destination filename in `.hatch3r/learnings/`. Defaults to the staged
   * file's basename. Validated via {@link validateLearningFileName} so a
   * traversal or non-`.md` name is rejected before any path is built.
   */
  as?: string;
  /** W5: `--format <human|json>`; json emits one envelope document. */
  format?: string;
  /** W5: `--quiet`: suppress stdout chrome (banner, success box). */
  quiet?: boolean;
  /**
   * W5: `--dry-run` — run every security/integrity gate (deny-scan, output
   * validation, quarantine, structural, integrity, refuse-overwrite) against
   * the staged file without persisting it.
   */
  dryRun?: boolean;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const INTEGRITY_LINE_REGEX = /^integrity:\s*sha256:([0-9a-fA-F]{64})\s*$/m;

/**
 * Split a learning file into `{ body }` — the content after the closing `---`
 * of the frontmatter — and the declared body-integrity hex (when present).
 * Mirrors the skill's "SHA-256 of body content (everything after frontmatter)"
 * contract so the recomputed digest matches what the skill stamped.
 */
function extractBodyAndIntegrity(raw: string): {
  body: string;
  declaredIntegrity?: string;
} {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) {
    // No frontmatter: the whole file is the body, no declared integrity.
    return { body: raw };
  }
  const [, frontmatter, body] = match;
  const integrityMatch = frontmatter.match(INTEGRITY_LINE_REGEX);
  return {
    body,
    declaredIntegrity: integrityMatch ? integrityMatch[1].toLowerCase() : undefined,
  };
}

/**
 * `hatch3r learn capture --file <path>` — commit a staged learning file through
 * the `persistLearning` security pipeline into `.hatch3r/learnings/`.
 */
export async function learnCaptureCommand(options: LearnCaptureOptions): Promise<void> {
  // W5: capture is headless (no prompts), so `--format json` is always valid.
  const format = beginCommand(options, { banner: "compact" });

  if (!options.file || typeof options.file !== "string") {
    logError("hatch3r learn capture requires --file <path> pointing at the staged learning file.");
    throw new HatchError(
      "Missing --file argument",
      2,
      "VALIDATION_ERROR",
      "Pass the path to the learning file your /learn flow wrote, e.g. `hatch3r learn capture --file .hatch3r/learnings/.staging/2026-06-06-vitest-tip.md`.",
    );
  }

  const rootDir = process.cwd();
  const sourcePath = isAbsolute(options.file) ? options.file : resolve(rootDir, options.file);

  // Read the staged file. A read failure (missing / unreadable) is a usage
  // error — the caller pointed --file at a path that does not exist.
  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    logError(`Cannot read staged learning file at ${sourcePath}.`);
    throw new HatchError(
      `Failed to read --file: ${(err as Error).message}`,
      2,
      code === "ENOENT" ? "VALIDATION_ERROR" : "FS_ERROR",
      "Confirm the path your /learn flow wrote to exists and is readable, then re-run `hatch3r learn capture --file <path>`.",
    );
  }

  // Resolve the destination filename (explicit --as wins, else the source
  // basename) and validate it BEFORE building the target path so a traversal
  // or non-.md name never reaches the join.
  const destName = typeof options.as === "string" && options.as.trim().length > 0
    ? options.as.trim()
    : basename(sourcePath);
  const nameErrors = validateLearningFileName(destName);
  if (nameErrors.length > 0) {
    for (const e of nameErrors) logError(e);
    throw new HatchError(
      `Invalid learning filename: ${destName}`,
      2,
      "VALIDATION_ERROR",
      "Use a `.md` filename with only alphanumerics, hyphens, underscores, and dots (no path separators).",
    );
  }

  const learningsDir = join(rootDir, HATCH3R_DIR, "learnings");
  const targetPath = join(learningsDir, destName);

  // Recompute the body-only integrity (everything after frontmatter, trimmed)
  // and compare against the `integrity: sha256:<hex>` the skill stamped. This
  // is the body-scope hash the skill's contract documents; persistLearning's
  // own expectedIntegrity hashes the FULL file bytes, so the two checks are
  // complementary — this one verifies the stamped frontmatter is self-consistent,
  // persistLearning's verifies the bytes were not mutated between here and disk.
  const { body, declaredIntegrity } = extractBodyAndIntegrity(raw);
  if (declaredIntegrity) {
    const recomputed = computeLearningIntegrity(body);
    if (recomputed !== declaredIntegrity) {
      logError(
        `Integrity mismatch: frontmatter declares sha256:${declaredIntegrity} but the body hashes to sha256:${recomputed}.`,
      );
      throw new HatchError(
        "Learning body integrity mismatch",
        // C8-D1-M5: omit exitCode so the central ERROR_CODE_TO_EXIT_CODE map
        // assigns the sysexits.h-aligned VALIDATION_ERROR code (EX_USAGE 64).
        undefined,
        "VALIDATION_ERROR",
        "The body was edited after the integrity hash was stamped. Recompute `integrity: sha256:<sha256-of-trimmed-body>` and re-run, or re-run the /learn flow to regenerate the file.",
      );
    }
  } else {
    warn(
      "Staged learning has no `integrity: sha256:<hex>` frontmatter line; writing without a body-integrity cross-check. The /learn flow should stamp one.",
    );
  }

  // persistLearning's atomic temp+rename writes the staging temp file INSIDE
  // the target directory, so `.hatch3r/learnings/` must exist first. The skill
  // contract ("If .hatch3r/learnings/ does not exist, create it") makes dir
  // provisioning the caller's job; create it idempotently before the write.
  // Skipped under --dry-run (no writes of any kind).
  const dryRun = options.dryRun === true;
  if (!dryRun) await mkdir(learningsDir, { recursive: true });

  // Commit through the security pipeline. persistLearning runs the three
  // injection gates + structural validation + refuse-overwrite, computes the
  // full-content digest, and atomic-writes the EXACT raw bytes (frontmatter +
  // body) so the on-disk learning retains the schema the loader reads. The
  // declared body-integrity (verified above) is preserved verbatim in those bytes.
  // Under --dry-run every gate still runs; only the final write is skipped.
  const result = await persistLearning(targetPath, raw, {
    source: "learn-command",
    dryRun,
  });

  for (const w of result.warnings) warn(w);

  if (result.rejections.length > 0) {
    logError(`Refused to capture ${destName} — the security pipeline rejected it:`);
    for (const r of result.rejections) logError(`  ${r}`);
    if (format === "json") {
      // Emit the structured payload before the throw so a CI consumer reads
      // the gate rejections from stdout (the throw goes to stderr).
      finishCommand(format, {
        command: "learn capture",
        title: "Learning capture blocked",
        lines: [],
        style: "error",
        json: {
          written: false,
          dryRun,
          integrity: result.integrity,
          rejections: result.rejections,
          warnings: result.warnings,
        },
      });
    }
    throw new HatchError(
      `Learning capture blocked by ${result.rejections.length} gate rejection(s)`,
      // C8-D1-M5: omit exitCode so the central ERROR_CODE_TO_EXIT_CODE map
      // assigns the sysexits.h-aligned VALIDATION_ERROR code (EX_USAGE 64).
      undefined,
      "VALIDATION_ERROR",
      "Revise the learning content (rephrase injection-resembling text, split oversized bodies, or pick a non-colliding filename) and re-run. Never bypass the gate with a raw file write.",
    );
  }

  // 2.6.0 capacity advisory — after a successful write only (dry-run persists
  // nothing, so its count would be misleading). Counts the same population
  // `validateLearningsDirectory` enforces (top-level `.md` files; `archive/`
  // is a subdirectory, so archived entries are excluded) and warns at >=80% of
  // the configured cap. Advisory only: it never blocks or fails the capture.
  let capacityWarning: string | undefined;
  if (!dryRun) {
    try {
      const manifest = await readManifest(rootDir).catch(() => null);
      const caps = resolveLearningsCaps(manifest?.learnings?.maxCount);
      const entries = await readdir(learningsDir);
      const activeCount = entries.filter((f) => f.endsWith(".md")).length;
      if (activeCount >= Math.ceil(caps.maxCount * 0.8)) {
        capacityWarning =
          `Learnings capacity: ${activeCount}/${caps.maxCount} active files (>=80% of the cap; ` +
          `set via learnings.maxCount in .hatch3r/hatch.json, default ${DEFAULT_LEARNING_FILE_COUNT}). ` +
          `Run the consolidation pass in the hatch3r-learn skill (merge same-topic entries, ` +
          `archive superseded ones) before sync/update hard-errors at the cap.`;
      }
    } catch (err) {
      // Advisory-only path: a manifest or directory read failure never blocks
      // a capture that already committed. Route the diagnostic to verbose.
      verbose(
        `learn capture: capacity check skipped — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (capacityWarning) warn(capacityWarning);

  if (dryRun) {
    finishCommand(format, {
      command: "learn capture",
      title: "Learning capture (dry-run)",
      lines: [
        label("File", targetPath),
        label("Integrity", `sha256:${result.integrity}`),
        label("Gates", "passed (deny-scan + agent-output + user-quarantine + structural)"),
        label("Write", "skipped (dry-run)"),
      ],
      style: "info",
      json: {
        written: false,
        dryRun: true,
        path: targetPath,
        integrity: result.integrity,
        warnings: result.warnings,
      },
    });
    return;
  }

  finishCommand(format, {
    command: "learn capture",
    title: "Learning captured",
    lines: [
      label("File", result.path ?? targetPath),
      label("Integrity", `sha256:${result.integrity}`),
      label("Gates", "passed (deny-scan + agent-output + user-quarantine + structural)"),
    ],
    style: "success",
    nextSteps: [
      // D13-SA13.4-02: state the true post-condition. `learn capture` writes the
      // learning file but does NOT regenerate `.hatch3r/learnings/INDEX.md` (an
      // agent-maintained file — "no CLI writes it" per the INDEX.md Format
      // contract in `rules/hatch3r-learning-system.md`). The INDEX-first
      // consultation gate skips non-INDEXed rows, so claiming automatic
      // consultation here would violate the Silent Failure Contract.
      "Written to `.hatch3r/learnings/`. This command does not update `.hatch3r/learnings/INDEX.md`.",
      "Regenerate INDEX.md (re-run the /learn skill, which rebuilds it) so the INDEX-first consultation gate can surface this learning.",
    ],
    json: {
      written: true,
      path: result.path ?? targetPath,
      integrity: result.integrity,
      warnings: capacityWarning
        ? [...result.warnings, capacityWarning]
        : result.warnings,
    },
  });
}
