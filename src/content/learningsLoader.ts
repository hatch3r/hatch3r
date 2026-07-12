/**
 * F6.4-H1 (D6, OWASP ASI06 Memory & Context Poisoning): runtime
 * materialization-time loader hook for `.hatch3r/learnings/*.md`.
 *
 * Background. `validateLearningsDirectory` in `learningsValidation.ts` is a
 * directory-level pre-flight pass invoked by `sync` and `validate` before
 * adapters materialise tool context files. It hard-fails (or warns) the
 * whole run when any learning file is invalid. The gap closed here is the
 * per-file LOADER-time gate: when a non-CLI consumer materialises learnings
 * at runtime (e.g. an adapter helper that reads `.hatch3r/learnings/` while
 * assembling a CLAUDE.md context block, or a future learnings hot-reload
 * surface), each file must be validated and unsafe entries silently skipped
 * with an audit-visible warning rather than refusing the whole load.
 *
 * Contract (per Cycle 10 Phase B Wave 1B):
 *   1. Enumerate `.hatch3r/learnings/*.md` (ENOENT collapses to "no
 *      learnings"; first-run is a clean state).
 *   2. For each candidate, run `validateLearningFileName` + per-file size
 *      cap + `validateLearningContent` against the same denylist used by
 *      the directory-level validator, then `sanitizeLearningsContent` for the
 *      poisoned-content disposition (D15-17).
 *   3. Files that fail structural validation OR carry a broad deny-pattern hit
 *      are SKIPPED from the returned set with a structured `LoaderSkip` entry
 *      (fail-closed) — never returned as content.
 *   4. Files that pass are returned as an audit-visible counter, NOT for a
 *      deterministic adapter sink to inline. No CLI adapter (claude/cursor/
 *      copilot) materializes the `learning` type into a context file —
 *      `src/adapters/canonical.ts` registers `learnings` in `READER_CONFIGS`
 *      but no `doGenerate` consumes it (D15-13, Cycle 11 Wave 3). Note the
 *      `READER_CONFIGS.learnings` entry maps `dir: "learnings"`, which resolves
 *      to a bundle-root `<canonicalRoot>/learnings/` that never exists —
 *      authoritative learnings live in `.hatch3r/learnings/` and are read only
 *      by THIS loader (D11-SA11.1-02). Do not route learnings through
 *      `readCanonicalFiles(bundledRoot, "learnings")`: it returns [] silently
 *      and mis-attributes "no learnings" when they are stored elsewhere. The
 *      actual
 *      runtime inlining is performed by the `hatch3r-learnings-loader` agent
 *      (Claude SessionStart hook, matcher `"startup"`, `src/adapters/claude.ts`),
 *      which reads `.hatch3r/learnings/INDEX.md` and selects rows itself. This
 *      `loaded` set therefore mirrors that agent's candidate pool so the count
 *      of learnings cleared for runtime load is observable at CLI-write time
 *      (sync surfaces it under `--verbose`). A file with only a P-LEARN
 *      structural hit is returned with the `[BLOCKED]`-substituted body so the
 *      user's legitimate learning text survives.
 *   5. Every skip is mirrored to:
 *        a. The Silent Failure Contract failure-log
 *           (`<rootDir>/.hatch3r/.failure-log.jsonl`) — never silent.
 *        b. The caller-supplied `onWarn` callback (defaults to a no-op so
 *           the loader does not couple to a particular UI layer).
 *
 * Pillars served: P6 (Security & Trust — deny-pattern + size-cap gates), P5
 * (Governance Self-Quality — Silent Failure Contract: every catch logs to
 * observability), CQ3 (Reliability — fail-closed at the file boundary while
 * keeping the load partial-success).
 *
 * Source: governance/audit/domains/D06-loader-and-context-injection.md SA6.4
 * (loader-time content-security gate), CONSTITUTION §2 P5 Silent Failure
 * Contract.
 */

import { readFile, readdir } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  sanitizeLearningsContent,
  validateLearningContent,
  validateLearningFileName,
} from "./learningsValidation.js";
import {
  createFailureLogEntry,
  formatLogEntry,
  FAILURE_LOG_FILE,
} from "../pipeline/failureLog.js";
import { HATCH3R_DIR } from "../types.js";

/** A learning file that survived every loader-time gate. */
export interface LoadedLearning {
  /** File name within `.hatch3r/learnings/` (e.g. `db-tips.md`). */
  fileName: string;
  /** Absolute path on disk; useful for diagnostics. */
  absolutePath: string;
  /**
   * File content after the loader-time disposition (D15-17): identical to the
   * raw bytes when nothing fired, or the `[BLOCKED]`-substituted variant when
   * a P-LEARN structural pattern matched. Files with a broad deny-pattern hit
   * never reach `loaded` — they are SKIPPED fail-closed.
   */
  content: string;
  /** Byte length of `content` (utf-8). */
  byteLength: number;
}

/** A learning file rejected at loader time, with an audit-visible reason. */
export interface LoaderSkip {
  fileName: string;
  reasons: string[];
}

/** Result of {@link loadValidatedLearnings}. */
export interface LoaderResult {
  loaded: LoadedLearning[];
  skipped: LoaderSkip[];
}

/** Options for {@link loadValidatedLearnings}. */
export interface LoadValidatedLearningsOptions {
  /**
   * Callback invoked once per skipped file. Defaults to a no-op so the
   * loader stays UI-agnostic. CLI consumers thread `warn` from
   * `src/cli/shared/ui.ts`; agents/test code can supply a collector.
   */
  onWarn?: (message: string) => void;
  /**
   * Loader source identifier embedded in failure-log entries. Defaults to
   * `"learnings-loader"`. Override when calling from a specific adapter
   * helper so downstream consumers can attribute warnings.
   */
  source?: string;
}

/**
 * Read every learning file under `<rootDir>/.hatch3r/learnings/`, validate
 * each one against the same gates the directory-level pre-flight uses, and
 * return:
 *   - `loaded`: valid files that cleared every gate — an audit-visible counter
 *     of the candidate pool the runtime `hatch3r-learnings-loader` agent may
 *     inline (no deterministic CLI/adapter sink inlines them; see contract
 *     item 4 above). Callers report the count, not inject the content.
 *   - `skipped`: rejected files with audit-visible reasons.
 *
 * Errors are NEVER thrown; the function honours the Silent Failure Contract
 * (CONSTITUTION §2 P5): unreachable directory, unreadable file, malformed
 * UTF-8, oversized body, or denied-pattern hit all route through the
 * skipped list + failure-log + `onWarn` channel.
 *
 * A missing `.hatch3r/learnings/` directory is treated as a clean state —
 * the function returns an empty result, NOT an error. First-run repos and
 * repos that opt out of project learnings both hit this path.
 *
 * @param rootDir   Absolute path to the user repository root.
 * @param options   Optional callback + audit-source overrides.
 */
export async function loadValidatedLearnings(
  rootDir: string,
  options: LoadValidatedLearningsOptions = {},
): Promise<LoaderResult> {
  const onWarn = options.onWarn ?? (() => undefined);
  const source = options.source ?? "learnings-loader";
  const learningsDir = join(rootDir, HATCH3R_DIR, "learnings");

  let entries: string[];
  try {
    entries = await readdir(learningsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { loaded: [], skipped: [] };
    }
    // Any other I/O error routes through failureLog so the caller does not
    // silently swallow a permissions problem on `.hatch3r/learnings/`.
    appendFailureLog(rootDir, source, err);
    onWarn(
      `learnings-loader: unable to enumerate ${learningsDir} — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return { loaded: [], skipped: [] };
  }

  const candidates = entries.filter((f) => f.endsWith(".md")).sort((a, b) => a.localeCompare(b));
  const loaded: LoadedLearning[] = [];
  const skipped: LoaderSkip[] = [];

  for (const fileName of candidates) {
    const reasons: string[] = [];

    // Gate 1: file name shape (extension, no traversal, alphanumeric start).
    const nameErrors = validateLearningFileName(fileName);
    reasons.push(...nameErrors);
    if (nameErrors.length > 0) {
      skipped.push({ fileName, reasons });
      announceSkip(rootDir, source, fileName, reasons, onWarn);
      continue;
    }

    const absolutePath = join(learningsDir, fileName);
    let content: string;
    try {
      content = await readFile(absolutePath, "utf-8");
    } catch (err) {
      const message = `cannot read ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`;
      reasons.push(message);
      skipped.push({ fileName, reasons });
      announceSkip(rootDir, source, fileName, reasons, onWarn);
      continue;
    }

    // Gate 2: per-file structural content (empty, binary, oversized).
    const validation = validateLearningContent(content, fileName);
    if (!validation.valid) {
      reasons.push(...validation.errors);
      skipped.push({ fileName, reasons });
      announceSkip(rootDir, source, fileName, reasons, onWarn);
      continue;
    }

    // Gate 3 (D15-17): poisoned-content disposition. The directory-level
    // pre-flight in `sync` BLOCKS the whole run on an injection hit; this
    // per-file loader runs even under `--force`, so it must neutralise rather
    // than abort. Run the sanitizer and apply the two-class policy documented
    // in `LearningsSanitizationResult` / `agents/shared/injection-patterns.md`:
    //   - broad deny-pattern hit  -> hard-SKIP (fail-closed, D2-SA2.3-2: a
    //     normalized match string cannot drive a reliable raw-byte
    //     substitution, so a partial neutralisation would leak surrounding
    //     adversarial text). The file is dropped, not loaded.
    //   - P-LEARN structural hit only -> load the `[BLOCKED]`-substituted
    //     variant so the user's legitimate learning text survives.
    const sanitization = sanitizeLearningsContent(content);
    if (sanitization.denyHits.length > 0) {
      reasons.push(
        ...sanitization.denyHits.map(
          (h) => `${h} — fail-closed: file not loaded into tool context`,
        ),
      );
      skipped.push({ fileName, reasons });
      announceSkip(rootDir, source, fileName, reasons, onWarn);
      continue;
    }

    let body = content;
    if (sanitization.structuralHits.length > 0) {
      body = sanitization.sanitized;
      for (const h of sanitization.structuralHits) {
        onWarn(`learnings-loader: ${fileName} — ${h}`);
      }
    }

    loaded.push({
      fileName,
      absolutePath,
      content: body,
      byteLength: Buffer.byteLength(body, "utf-8"),
    });
  }

  return { loaded, skipped };
}

/**
 * Announce a skipped file: write the structured reason set to the
 * failureLog, then emit a human-readable summary through `onWarn`.
 */
function announceSkip(
  rootDir: string,
  source: string,
  fileName: string,
  reasons: string[],
  onWarn: (message: string) => void,
): void {
  const reasonSummary = reasons.length === 1
    ? reasons[0]
    : `${reasons.length} loader-gate failure(s): ${reasons.join("; ")}`;
  const message = `learnings-loader: skipped ${fileName} — ${reasonSummary}`;
  appendFailureLog(
    rootDir,
    source,
    new Error(message),
  );
  onWarn(message);
}

/**
 * Append a single failureLog entry for a learnings loader skip / I/O error.
 * Silent Failure Contract: any I/O failure on the failure-log itself is
 * swallowed — the loader must never throw, even when its own logging path
 * cannot write.
 */
function appendFailureLog(rootDir: string, source: string, err: unknown): void {
  try {
    const entry = createFailureLogEntry(source, err);
    const line = formatLogEntry(entry) + "\n";
    const failurePath = join(rootDir, HATCH3R_DIR, FAILURE_LOG_FILE);
    mkdirSync(dirname(failurePath), { recursive: true });
    appendFileSync(failurePath, line);
  } catch {
    // silent-failure: the failureLog channel itself is the last resort;
    // there is no further escalation surface available without breaking the
    // loader's no-throw contract (CONSTITUTION.md §2 P5).
    void err;
  }
}
