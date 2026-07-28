import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  appendReviewLoopTelemetry,
  createReviewLoop,
  canContinueReview,
  recordReviewIteration,
  terminateReviewLoop,
  reviewLoopSummary,
  reviewLoopConfidence,
  detectOscillation,
  detectSuppressionPatterns,
  enforceReviewIteration,
  assertReviewIterationAllowed,
  evaluateReviewGate,
  confidenceExplanation,
  CALIBRATION,
  CALIBRATION_SAMPLE_THRESHOLD,
  DEFAULT_MAX_REVIEW_ITERATIONS,
  HARD_MAX_REVIEW_ITERATIONS,
  MIN_MAX_REVIEW_ITERATIONS,
  MIN_DIVERGENCE_HISTORY,
  DIVERGENCE_MESSAGE,
  REVIEW_LOOP_CLASS_CAPS,
  REVIEW_LOOP_METRICS_RELPATH,
  REVIEW_LOOP_TERMINATION_REASONS,
  maxIterationsForClass,
  reviewLoopLedgerEntry,
  serializeReviewLoopLedgerEntry,
  parseReviewLoopLedger,
  deriveIterationSplit,
  iterationVerdictToHandoffVerdict,
  type ReviewConfidenceLevel,
  type ReviewIterationVerdict,
  type ReviewLoopClass,
  type ReviewLoopLedgerEntry,
  type ReviewLoopTerminationReason,
} from "../../pipeline/reviewLoop.js";
import { HatchError } from "../../types.js";

describe("reviewLoop", () => {
  describe("createReviewLoop", () => {
    it("should create a loop with default max iterations", () => {
      const state = createReviewLoop();
      expect(state.currentIteration).toBe(0);
      expect(state.maxIterations).toBe(DEFAULT_MAX_REVIEW_ITERATIONS);
      expect(state.terminated).toBe(false);
      expect(state.history).toHaveLength(0);
      expect(state.unresolvedFindings).toBe(0);
    });

    it("should accept custom max iterations", () => {
      const state = createReviewLoop(5);
      expect(state.maxIterations).toBe(5);
    });

    it("should clamp max iterations to MIN_MAX_REVIEW_ITERATIONS", () => {
      const state = createReviewLoop(0);
      expect(state.maxIterations).toBe(MIN_MAX_REVIEW_ITERATIONS);

      const stateNeg = createReviewLoop(-5);
      expect(stateNeg.maxIterations).toBe(MIN_MAX_REVIEW_ITERATIONS);
    });

    it("should clamp max iterations to HARD_MAX", () => {
      const state = createReviewLoop(999);
      expect(state.maxIterations).toBe(HARD_MAX_REVIEW_ITERATIONS);
    });
  });

  describe("canContinueReview", () => {
    it("should return true for a fresh loop", () => {
      const state = createReviewLoop(3);
      expect(canContinueReview(state)).toBe(true);
    });

    it("should return false for a terminated loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      expect(canContinueReview(state)).toBe(false);
    });

    it("should return false when max iterations reached", () => {
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 5);
      expect(canContinueReview(state)).toBe(false);
    });

    it("should return true when there are remaining iterations", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "critical", 5);
      expect(canContinueReview(state)).toBe(true);
    });
  });

  describe("recordReviewIteration", () => {
    it("should advance the iteration counter", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      expect(state.currentIteration).toBe(1);
      expect(state.history).toHaveLength(1);
      expect(state.history[0].verdict).toBe("warning");
      expect(state.history[0].findingsCount).toBe(2);
    });

    it("should terminate on clean verdict", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("clean");
      expect(state.unresolvedFindings).toBe(0);
      expect(state.currentIteration).toBe(2);
    });

    it("should terminate at max iterations with unresolved findings", () => {
      let state = createReviewLoop(2);
      state = recordReviewIteration(state, "critical", 5);
      state = recordReviewIteration(state, "warning", 3);
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("max_iterations");
      expect(state.unresolvedFindings).toBe(3);
    });

    it("should throw if loop is already terminated", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);

      expect(() => recordReviewIteration(state, "warning", 1)).toThrow(
        "already terminated",
      );
    });

    it("should throw if loop is at max iterations without termination", () => {
      // Create loop with max 1 and record critical (which terminates at max)
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 3);
      // Now it's terminated, so further recording should throw
      expect(() => recordReviewIteration(state, "warning", 1)).toThrow(
        "already terminated",
      );
    });

    it("should track full iteration history", () => {
      let state = createReviewLoop(5);
      state = recordReviewIteration(state, "critical", 10);
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "clean", 0);

      expect(state.history).toHaveLength(4);
      expect(state.history[0].iteration).toBe(1);
      expect(state.history[1].iteration).toBe(2);
      expect(state.history[2].iteration).toBe(3);
      expect(state.history[3].iteration).toBe(4);
      expect(state.history.every((h) => h.timestamp)).toBe(true);
    });
  });

  describe("terminateReviewLoop", () => {
    it("should manually terminate a running loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 5);
      state = terminateReviewLoop(state, 5);

      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("manual");
      expect(state.unresolvedFindings).toBe(5);
    });

    it("should be a no-op on an already terminated loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      const before = { ...state };
      state = terminateReviewLoop(state, 99);

      expect(state.terminationReason).toBe("clean");
      expect(state.unresolvedFindings).toBe(before.unresolvedFindings);
    });

    it("should default to 0 unresolved findings", () => {
      let state = createReviewLoop(3);
      state = terminateReviewLoop(state);
      expect(state.unresolvedFindings).toBe(0);
    });
  });

  describe("reviewLoopSummary", () => {
    it("should summarize in-progress loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("1/3 iterations");
      expect(summary).toContain("in progress");
    });

    it("should summarize clean termination", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("clean verdict");
    });

    it("should summarize max iterations termination", () => {
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 5);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("max iterations reached");
      expect(summary).toContain("5 unresolved findings");
    });

    it("should summarize manual termination", () => {
      let state = createReviewLoop(3);
      state = terminateReviewLoop(state);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("manual stop");
    });
  });

  describe("programmatic enforcement", () => {
    it("should enforce max default iterations and surface remaining findings", () => {
      let state = createReviewLoop();

      // Simulate DEFAULT_MAX_REVIEW_ITERATIONS iterations that never reach clean.
      // The final iteration must terminate the loop with max_iterations.
      for (let i = 1; i < DEFAULT_MAX_REVIEW_ITERATIONS; i++) {
        state = recordReviewIteration(state, "critical", 10 - i);
        expect(canContinueReview(state)).toBe(true);
      }

      state = recordReviewIteration(state, "warning", 3);
      // After the final iteration (max), loop must be terminated
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("max_iterations");
      expect(state.unresolvedFindings).toBe(3);
      expect(canContinueReview(state)).toBe(false);
    });

    it("default matches DEFAULT_MAX_REVIEW_ITERATIONS", () => {
      // Finding C7.5-W2B2-H26: the default was raised from 3 to 4 so
      // the oscillation detector can fire in default config.
      expect(DEFAULT_MAX_REVIEW_ITERATIONS).toBe(4);
    });

    it("opt-down to the pre-Cycle-7.5 default of 3 is accepted", () => {
      // Finding C7.5-W2B2-H26: callers that want the prior behaviour must
      // be able to configure it.
      const state = createReviewLoop(3);
      expect(state.maxIterations).toBe(3);
    });

    it("D15-M5: mechanical counter — recordReviewIteration is the only path that advances currentIteration", () => {
      // D15-M5 (D15-SA15.2 review-loop integrity): the prior validation column
      // for "Review Loop Limits" in D15-trust-reference.md was "Manual audit".
      // This test makes the mechanical counter the validation surface so the
      // automated trust-reference row "validate review-loop-mechanical" can cite
      // an executable artefact instead of an unsigned human attestation.
      //
      // Three deterministic assertions, each closing a documented bypass route:
      //   1. currentIteration is set to 0 by createReviewLoop and only advances
      //      via the recordReviewIteration code path (no other exported function
      //      mutates it).
      //   2. recordReviewIteration THROWS once currentIteration === maxIterations,
      //      so a caller cannot keep recording past the cap by accident.
      //   3. After max_iterations termination, both the terminated flag and the
      //      unresolvedFindings count are populated — a downstream gate cannot
      //      observe an "in-progress" loop that has already exhausted its budget.
      const initial = createReviewLoop(3);
      expect(initial.currentIteration).toBe(0);
      let s = recordReviewIteration(initial, "warning", 4);
      expect(s.currentIteration).toBe(1);
      s = recordReviewIteration(s, "warning", 3);
      expect(s.currentIteration).toBe(2);
      s = recordReviewIteration(s, "warning", 2);
      expect(s.currentIteration).toBe(3);
      expect(s.terminated).toBe(true);
      expect(s.terminationReason).toBe("max_iterations");
      expect(s.unresolvedFindings).toBe(2);
      // Past the cap: any further recordReviewIteration is rejected with
      // HatchError — the loop body cannot silently widen its budget.
      expect(() => recordReviewIteration(s, "warning", 1)).toThrow(HatchError);
      expect(() => recordReviewIteration(s, "warning", 1)).toThrow(
        /already terminated/,
      );
    });

    // Finding D7-3 (Cycle 11, High): the convergence-contract parity guard
    // previously covered only 4 of the ~12 cap-stating surfaces — the
    // orchestration rule (.md/.mdc) and the reviewer/fixer agent prompts.
    // Green CI therefore hid the contradiction the module header asserts:
    // "the iteration cap is enforced by the prompt directive" while unchecked
    // command bodies and the detail rule could drift freely.
    //
    // CAP_SURFACE_REGISTRY below is the single enumerated source of every
    // file that states the review-loop iteration cap. Each entry declares its
    // loop class; the expected integer comes from REVIEW_LOOP_CLASS_CAPS in
    // src/pipeline/reviewLoop.ts — the SHIPPED loop-class taxonomy. The class
    // definitions, selection rule (code diff vs spec text vs generic pipeline
    // bound), and convergence basis live in that module's JSDoc, no longer
    // only in this test (Findings D5-SA5.4-03 / D8-SA8.3-02, Cycle 12). A
    // future change to the code constant forces every prose surface to be
    // updated in the same change (or the parity test fails).
    // `occurrences` pins how many times the cap phrase appears per file, so
    // adding or deleting a cap statement (not just changing its integer) also
    // trips the guard — the registry is exhaustive, not best-effort.
    const CODE_CLASS_CAP = REVIEW_LOOP_CLASS_CAPS.code;
    const capForClass = maxIterationsForClass;

    interface CapSurface {
      /** Repo-root-relative path to the cap-stating file. */
      path: string;
      /** Human label for assertion messages. */
      label: string;
      /** Loop class that fixes the expected integer ({@link ReviewLoopClass}). */
      loopClass: ReviewLoopClass;
      /** Global regex whose first capture group is the stated cap integer. */
      regex: RegExp;
      /** Exact number of times the regex must match in the file. */
      occurrences: number;
    }

    const CAP_SURFACE_REGISTRY: readonly CapSurface[] = [
      // ── unified cap scheme (release/2.8.5) ─────────────────────────────
      // The orchestration rule pair states the scheme once: loop-class caps
      // (code 3 / spec 4 from REVIEW_LOOP_CLASS_CAPS) under the protocol
      // ceiling DEFAULT_MAX_REVIEW_ITERATIONS. Two entries per file pin all
      // three integers: the class-caps pair (group 1 = code, group 2 = spec —
      // spec numerically equals the DEFAULT the m[2] check asserts) and the
      // symbolic ceiling.
      {
        path: "rules/hatch3r-agent-orchestration.md",
        label: "orchestration rule (canonical) unified-scheme class caps",
        loopClass: "code",
        regex:
          /— (\d+) for code-diff loops, (\d+) for spec\/issue-text loops — under the protocol ceiling/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration.md",
        label: "orchestration rule (canonical) protocol ceiling",
        loopClass: "default",
        regex: /protocol ceiling `DEFAULT_MAX_REVIEW_ITERATIONS = (\d+)`/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration.mdc",
        label: "orchestration rule (Cursor parity) unified-scheme class caps",
        loopClass: "code",
        regex:
          /— (\d+) for code-diff loops, (\d+) for spec\/issue-text loops — under the protocol ceiling/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration.mdc",
        label: "orchestration rule (Cursor parity) protocol ceiling",
        loopClass: "default",
        regex: /protocol ceiling `DEFAULT_MAX_REVIEW_ITERATIONS = (\d+)`/g,
        occurrences: 1,
      },
      {
        path: "agents/hatch3r-reviewer.md",
        label: "reviewer agent Review Loop Termination (class cap + ceiling)",
        loopClass: "code",
        regex:
          /After the class cap \((\d+) code-diff \/ (\d+) spec-text iterations per `REVIEW_LOOP_CLASS_CAPS`; protocol ceiling `DEFAULT_MAX_REVIEW_ITERATIONS=(\d+)`/g,
        occurrences: 1,
      },
      {
        path: "agents/hatch3r-fixer.md",
        label: "fixer agent Review Loop Termination (class cap + ceiling)",
        loopClass: "code",
        regex:
          /After the class cap \((\d+) code-diff \/ (\d+) spec-text iterations per `REVIEW_LOOP_CLASS_CAPS`; protocol ceiling `DEFAULT_MAX_REVIEW_ITERATIONS=(\d+)`/g,
        occurrences: 1,
      },
      {
        // Finding D5-20: the implementer agent's Review Loop Awareness section
        // states the orchestrator's Phase-3 cap but was absent from the
        // registry, so its prior "max 3" drifted from the code constant and
        // the reviewer/fixer surfaces. Pinned to the unified-scheme phrasing.
        path: "agents/hatch3r-implementer.md",
        label: "implementer agent Review Loop Awareness (class cap + ceiling)",
        loopClass: "code",
        regex:
          /loop-class cap — (\d+) code-diff \/ (\d+) spec-text per `REVIEW_LOOP_CLASS_CAPS`, protocol ceiling `DEFAULT_MAX_REVIEW_ITERATIONS = (\d+)`/g,
        occurrences: 1,
      },
      // ── spec class (== DEFAULT_MAX_REVIEW_ITERATIONS) ─────────────────
      {
        path: "commands/hatch3r-board-fill.md",
        label: "board-fill per-issue spec-class loop",
        loopClass: "spec",
        regex: /max\s+(\d+)\s+iterations\s+\(spec-class cap\)/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-board-fill.md",
        label: "board-fill spec-class rationale (matching DEFAULT_MAX_REVIEW_ITERATIONS)",
        loopClass: "spec",
        regex: /caps at\s+(\d+)\s+\(matching\s+`DEFAULT_MAX_REVIEW_ITERATIONS`/g,
        occurrences: 1,
      },
      // ── code class (== DEFAULT_MAX_REVIEW_ITERATIONS - 1) ─────────────
      {
        path: "commands/hatch3r-quick-change.md",
        label: "quick-change review loop (table row + Step 6a body)",
        loopClass: "code",
        regex: /max\s+(\d+)\s+iterations/g,
        occurrences: 2,
      },
      // release/2.6.0: commands/hatch3r-rework.md (formerly revision) left the
      // registry — the redesigned command runs a single read-only reviewer
      // validation pass and states no review-loop cap.
      {
        path: "commands/hatch3r-board-pickup.md",
        label: "board-pickup review loop (table row)",
        loopClass: "code",
        regex: /max\s+(\d+)\s+iterations/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-workflow.md",
        label: "workflow review loop (table row)",
        loopClass: "code",
        regex: /\(max\s+(\d+)\s+iterations until clean\)/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-workflow.md",
        label: "workflow Step 4a repeat directive (code-class cap)",
        loopClass: "code",
        regex: /maximum of \*\*(\d+) iterations\*\*\s+\(code-class cap\)/g,
        occurrences: 1,
      },
      // Finding D8-SA8.3-02 (Cycle 12) + release/2.8.5 unified scheme: the
      // detail rule's cap sites now cite the loop-class caps (code 3 / spec 4
      // per REVIEW_LOOP_CLASS_CAPS) under the symbolic protocol ceiling. Four
      // entries per file pin the iterations comment, the failure-mode table,
      // the retry-policy class caps, and the retry-policy ceiling (the
      // HARD_MAX clamp integer is deliberately not captured — the m[2] check
      // asserts against DEFAULT_MAX_REVIEW_ITERATIONS only).
      {
        path: "rules/hatch3r-agent-orchestration-detail.md",
        label: "detail rule PipelineContext reviewResult.iterations comment (canonical)",
        loopClass: "code",
        regex:
          /1 to the loop-class cap \(code (\d+) \/ spec (\d+) per REVIEW_LOOP_CLASS_CAPS; ceiling DEFAULT_MAX_REVIEW_ITERATIONS = (\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.md",
        label: "detail rule failure-mode table (canonical)",
        loopClass: "code",
        regex:
          /Loop-class cap reached \(code (\d+) \/ spec (\d+); ceiling `DEFAULT_MAX_REVIEW_ITERATIONS` = (\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.md",
        label: "detail rule retry-policy code-class rationale (canonical)",
        loopClass: "code",
        regex: /(\d+) for code-diff loops, which diverge faster/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.md",
        label: "detail rule retry-policy protocol ceiling (canonical)",
        loopClass: "default",
        regex:
          /under the protocol ceiling `DEFAULT_MAX_REVIEW_ITERATIONS = (\d+)`, overrides clamped/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.mdc",
        label: "detail rule PipelineContext reviewResult.iterations comment (Cursor parity)",
        loopClass: "code",
        regex:
          /1 to the loop-class cap \(code (\d+) \/ spec (\d+) per REVIEW_LOOP_CLASS_CAPS; ceiling DEFAULT_MAX_REVIEW_ITERATIONS = (\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.mdc",
        label: "detail rule failure-mode table (Cursor parity)",
        loopClass: "code",
        regex:
          /Loop-class cap reached \(code (\d+) \/ spec (\d+); ceiling `DEFAULT_MAX_REVIEW_ITERATIONS` = (\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.mdc",
        label: "detail rule retry-policy code-class rationale (Cursor parity)",
        loopClass: "code",
        regex: /(\d+) for code-diff loops, which diverge faster/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.mdc",
        label: "detail rule retry-policy protocol ceiling (Cursor parity)",
        loopClass: "default",
        regex:
          /under the protocol ceiling `DEFAULT_MAX_REVIEW_ITERATIONS = (\d+)`, overrides clamped/g,
        occurrences: 1,
      },
      // Finding D7-1: four code-class loop directives that stated a numeric cap
      // but were absent from the registry — they could drift freely while green
      // CI hid it (the exact gap the self-check claim at line "11 distinct
      // files" asserted was closed). Pin each loop-termination directive.
      {
        path: "commands/hatch3r-release.md",
        label: "release Step 7a review-loop termination directive (code-class cap)",
        loopClass: "code",
        regex: /for a maximum of \*\*(\d+) iterations\*\* \(code-class cap per/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-debug.md",
        label: "debug Stage 5c review-loop termination directive (code-class cap)",
        loopClass: "code",
        regex: /Run a review-fix loop, maximum (\d+) iterations, until the reviewer/g,
        occurrences: 1,
      },
      {
        path: "commands/board/pickup-delegation.md",
        label: "board-pickup delegation review-loop termination directive (code-class cap)",
        loopClass: "code",
        regex: /Repeat steps 2-3 for a maximum of \*\*(\d+) iterations\*\* until the confidence-aware gate/g,
        occurrences: 1,
      },
      {
        path: "commands/board/pickup-delegation-multi.md",
        label: "board-pickup delegation-multi review-loop termination directive (code-class cap)",
        loopClass: "code",
        regex: /Repeat steps 2-3 for a maximum of \*\*(\d+) iterations\*\* until the confidence-aware gate/g,
        occurrences: 1,
      },
      // Finding D5-SA5.4-03 (Cycle 12): bug-pipeline's Step-3 loop reviews
      // bug-fix CODE diffs — the canonical regression-spawning case the
      // code-class rationale names — so it is code-class. Its prior "max 4,
      // matching DEFAULT_MAX_REVIEW_ITERATIONS" statements predated the
      // shipped taxonomy and made it the only code-diff command running at
      // the default cap; reclassified with the taxonomy shipped in
      // REVIEW_LOOP_CLASS_CAPS. The Step-3.3 termination directive was a
      // third, previously unpinned cap integer in the same file.
      {
        path: "commands/hatch3r-bug-pipeline.md",
        label: "bug-pipeline root-cause-depth review loop (table row, code-class cap)",
        loopClass: "code",
        regex: /\(max\s+(\d+)\s+iterations\)\s+\|\s+No \(sequential\)/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-bug-pipeline.md",
        label: "bug-pipeline review-loop body (code-class cap per REVIEW_LOOP_CLASS_CAPS)",
        loopClass: "code",
        regex: /max\s+(\d+)\s+iterations\s+\(code-class cap per\s+`REVIEW_LOOP_CLASS_CAPS`/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-bug-pipeline.md",
        label: "bug-pipeline Step-3.3 termination directive (code-class cap)",
        loopClass: "code",
        regex: /If the code-class cap of (\d+) iterations completes/g,
        occurrences: 1,
      },
      // Finding D7-SA7.2-02 (Cycle 12): cap-stating files the hand-maintained
      // registry forgot. pr-resolve.md states the code-class cap 5× (its
      // Stage-1 loop body is self-contained since the 2.6.0 rework redesign
      // retired the shared revision-quality.md loop body); the
      // adhoc-orchestrate SKILL states the generic default-class Phase-3 bound
      // in its Per-Turn Pipeline-State Header ("max 4 iterations"). The prior
      // `length >= 20` floor could not catch their omission; the completeness
      // assertion below now enforces membership. pr-resolve runs the code-class
      // loop (cap 3); adhoc-orchestrate carries the full default bound (4).
      {
        path: "commands/hatch3r-pr-resolve.md",
        label:
          "pr-resolve Stage-1 review loop (frontmatter + table + Tier-2 + Step-7b body)",
        loopClass: "code",
        regex: /max\s+(\d+)\s+iterations/g,
        occurrences: 4,
      },
      {
        path: "commands/hatch3r-pr-resolve.md",
        label: "pr-resolve Step-10 review-loop-cap ASK trigger",
        loopClass: "code",
        regex: /Review loop hits (\d+) iterations with findings remaining/g,
        occurrences: 1,
      },
      {
        path: "skills/hatch3r-adhoc-orchestrate/SKILL.md",
        label:
          "adhoc-orchestrate Per-Turn Pipeline-State Header Phase-3 bound (default-class cap)",
        loopClass: "default",
        regex: /max\s+(\d+)\s+iterations/g,
        occurrences: 1,
      },
    ];

    it("every review-loop cap surface in CAP_SURFACE_REGISTRY matches its loop class (Finding D7-3)", () => {
      // Finding C9-M48 / D15-SA15.2-F15.2-06 / D5-SA5.1-F1 are subsumed here:
      // the rule (.md/.mdc) and reviewer/fixer surfaces remain covered, now as
      // registry entries alongside the previously-uncovered command + detail
      // surfaces. The registry is the enumerated single source — extend it
      // when a new cap-stating surface is authored.
      const repoRoot = process.cwd();
      // Self-check — real completeness assertion (Finding D7-SA7.2-02). The
      // registry is the single enumerated source of every file that states the
      // review-loop cap; its "exhaustive, not best-effort" contract is now
      // ENFORCED, not asserted in a comment. Scan the five shipped canonical-
      // content dirs for every file that DECLARES a cap ("max|maximum N
      // iterations") and assert each appears as a CAP_SURFACE_REGISTRY path.
      // This replaces the prior `length >= 20` floor, which only caught the
      // registry being emptied and let a cap-stating file be omitted while CI
      // stayed green — the exact re-opened gap for pr-resolve.md and the
      // adhoc-orchestrate SKILL. 31 entries across 18 distinct registered
      // files today. The detector is a lower bound tuned
      // to the drift-prone "max N iterations" form: reviewer/fixer state the cap
      // as "review-fix cycles" and are covered by explicit entries the detector
      // does not re-flag — safe, since the assertion only requires
      // detector-matched files to be a subset of the registry paths.
      const CAP_DECLARATION_DETECTOR =
        /\bmax(?:imum)?\b(?:\s+of)?\s+\*{0,2}(\d+)\s+iterations/i;
      const CONTENT_DIRS = ["agents", "commands", "rules", "skills", "hooks"];
      const registryPaths = new Set(CAP_SURFACE_REGISTRY.map((s) => s.path));
      const capStatingFiles: string[] = [];
      for (const dir of CONTENT_DIRS) {
        const dirAbs = join(repoRoot, dir);
        if (!existsSync(dirAbs)) continue;
        const entries = readdirSync(dirAbs, { recursive: true }) as string[];
        for (const rel of entries) {
          if (!rel.endsWith(".md") && !rel.endsWith(".mdc")) continue;
          const body = readFileSync(join(dirAbs, rel), "utf-8");
          if (!CAP_DECLARATION_DETECTOR.test(body)) continue;
          capStatingFiles.push(`${dir}/${rel}`.split("\\").join("/"));
        }
      }
      // Non-vacuity floor: the scan must surface the known cap surfaces so a
      // wholesale prose rewrite cannot make the completeness check pass on an
      // empty set. The per-entry occurrence loop below independently pins each
      // registered statement.
      expect(
        capStatingFiles.length,
        "cap-declaration scan surfaced too few files — the detector or the shipped cap prose moved; completeness would pass vacuously",
      ).toBeGreaterThanOrEqual(10);
      const unregistered = capStatingFiles
        .filter((f) => !registryPaths.has(f))
        .sort();
      expect(
        unregistered,
        `these shipped files DECLARE a review-loop cap ("max N iterations") but are absent from CAP_SURFACE_REGISTRY — add an entry (loop class + cap phrasing) for each. The registry is the enumerated single source (exhaustive, not best-effort); a cap-stating file must never be omitted (Finding D7-SA7.2-02).`,
      ).toEqual([]);

      for (const surface of CAP_SURFACE_REGISTRY) {
        const body = readFileSync(join(repoRoot, surface.path), "utf-8");
        const matches = [...body.matchAll(surface.regex)];
        expect(
          matches.length,
          `${surface.path} [${surface.label}] — expected ${surface.occurrences} cap statement(s) matching ${surface.regex} but found ${matches.length}. If the cap phrasing changed, update CAP_SURFACE_REGISTRY (the enumerated single source).`,
        ).toBe(surface.occurrences);

        const expectedCap = capForClass(surface.loopClass);
        for (const m of matches) {
          // First capture group is always the stated cap integer.
          const declared = Number(m[1]);
          expect(
            declared,
            `${surface.path} [${surface.label}] declared "${m[0]}" (cap ${declared}) but loop class "${surface.loopClass}" must equal ${expectedCap} (DEFAULT_MAX_REVIEW_ITERATIONS=${DEFAULT_MAX_REVIEW_ITERATIONS}, code-class=${CODE_CLASS_CAP}).`,
          ).toBe(expectedCap);
          // The reviewer/fixer surfaces additionally inline the constant
          // (DEFAULT_MAX_REVIEW_ITERATIONS=<N>) as a second capture group;
          // assert it tracks the code constant when present.
          if (m[2] !== undefined) {
            const inlineConstant = Number(m[2]);
            expect(
              inlineConstant,
              `${surface.path} [${surface.label}] inline DEFAULT_MAX_REVIEW_ITERATIONS=${inlineConstant} must match code constant ${DEFAULT_MAX_REVIEW_ITERATIONS}`,
            ).toBe(DEFAULT_MAX_REVIEW_ITERATIONS);
          }
        }
      }
    });

    // Finding D7-2 (Cycle 11, High): the detail rule's cross-command Pipeline
    // Pattern table states the default-class Phase-3 cap symbolically
    // (`max \`DEFAULT_MAX_REVIEW_ITERATIONS\``), NOT as a bare integer. That is
    // the correct full-default cap (4), distinct from the code-class cap (3)
    // the three code-class surfaces above carry. Pin it to stay symbolic so a
    // future edit cannot re-introduce a third drifting integer answer for the
    // cap (the "three answers for one cap" the finding flagged).
    it("detail rule default-class Phase-3 row references DEFAULT_MAX_REVIEW_ITERATIONS symbolically, not a bare integer (Finding D7-2)", () => {
      // release/2.8.5 unified scheme: the row states the loop-class caps as
      // integers under the SYMBOLIC ceiling. Both integers are asserted
      // against REVIEW_LOOP_CLASS_CAPS so they cannot drift, and the ceiling
      // must stay symbolic — a bare ceiling integer here re-opens the
      // cap-drift gap the finding flagged.
      const repoRoot = process.cwd();
      for (const path of [
        "rules/hatch3r-agent-orchestration-detail.md",
        "rules/hatch3r-agent-orchestration-detail.mdc",
      ]) {
        const body = readFileSync(join(repoRoot, path), "utf-8");
        const symbolicRow =
          /Phase 3 Review Loop \| `hatch3r-reviewer` ↔ `hatch3r-fixer` \(loop-class cap (\d+) code \/ (\d+) spec under ceiling `DEFAULT_MAX_REVIEW_ITERATIONS`/g;
        const matches = [...body.matchAll(symbolicRow)];
        expect(
          matches.length,
          `${path} — the cross-command Pipeline Pattern Phase-3 row must state the loop-class caps under the symbolic ceiling \`DEFAULT_MAX_REVIEW_ITERATIONS\`. A bare ceiling integer here re-opens the cap-drift gap (Finding D7-2).`,
        ).toBe(1);
        expect(
          Number(matches[0][1]),
          `${path} — Phase-3 row code-class cap must equal REVIEW_LOOP_CLASS_CAPS.code`,
        ).toBe(REVIEW_LOOP_CLASS_CAPS.code);
        expect(
          Number(matches[0][2]),
          `${path} — Phase-3 row spec-class cap must equal REVIEW_LOOP_CLASS_CAPS.spec`,
        ).toBe(REVIEW_LOOP_CLASS_CAPS.spec);
      }
    });
  });

  describe("reviewLoopConfidence (Finding #68)", () => {
    it("should return high confidence for clean verdict on first iteration", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.confidence).toBe("high");
      expect(reviewLoopConfidence(state)).toBe("high");
    });

    it("should return medium confidence for clean verdict on second iteration", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.confidence).toBe("medium");
      expect(reviewLoopConfidence(state)).toBe("medium");
    });

    it("should return low confidence for clean verdict on third or later iteration", () => {
      let state = createReviewLoop(5);
      state = recordReviewIteration(state, "critical", 5);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.confidence).toBe("low");
      expect(reviewLoopConfidence(state)).toBe("low");
    });

    it("should return low confidence for max_iterations termination", () => {
      let state = createReviewLoop(2);
      state = recordReviewIteration(state, "critical", 5);
      state = recordReviewIteration(state, "warning", 3);
      expect(state.confidence).toBe("low");
      expect(reviewLoopConfidence(state)).toBe("low");
    });

    it("should return low confidence for manual termination", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      state = terminateReviewLoop(state, 2);
      expect(state.confidence).toBe("low");
      expect(reviewLoopConfidence(state)).toBe("low");
    });

    it("should include confidence in summary for terminated loops", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("confidence: high");
    });

    it("should include low confidence in summary for max iterations", () => {
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 5);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("confidence: low");
    });

    it("should not include confidence in summary for in-progress loops", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      const summary = reviewLoopSummary(state);
      expect(summary).not.toContain("confidence:");
    });
  });

  describe("detectOscillation (#244, D8-8.11)", () => {
    it("should report insufficient data for fewer than 3 iterations", () => {
      let state = createReviewLoop(5);
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 3);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
      expect(result.description).toContain("Insufficient history");
    });

    it("should detect oscillation pattern: up-down-up", () => {
      let state = createReviewLoop(10);
      // Findings: 5 -> 2 -> 6 -> 1 (down, up, down = 2 direction changes)
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 6);
      state = recordReviewIteration(state, "warning", 1);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(true);
      expect(result.description).toContain("oscillation detected");
      expect(result.description).toContain("direction changes");
    });

    it("should not detect oscillation for monotonically decreasing findings", () => {
      let state = createReviewLoop(5);
      // Findings: 10 -> 7 -> 4 -> 1 (consistently decreasing)
      state = recordReviewIteration(state, "critical", 10);
      state = recordReviewIteration(state, "warning", 7);
      state = recordReviewIteration(state, "warning", 4);
      state = recordReviewIteration(state, "clean", 0);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
    });

    it("should not detect oscillation for monotonically increasing findings", () => {
      let state = createReviewLoop(5);
      // Findings: 1 -> 3 -> 5 (consistently increasing -- bad but not oscillating)
      state = recordReviewIteration(state, "warning", 1);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 5);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
    });

    it("should not detect oscillation for flat findings counts", () => {
      let state = createReviewLoop(5);
      // Findings: 3 -> 3 -> 3 (no direction at all)
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 3);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
    });

    it("should detect oscillation on a single direction change (Finding D7-16 re-threshold)", () => {
      let state = createReviewLoop(5);
      // Findings: 5 -> 2 -> 4 (down, up = 1 direction change). Cycle 11 lowered
      // the threshold from 2 changes to 1 (Finding D7-16) so a fix-break cycle
      // is caught on the first reversal within a 3-entry default-reachable history.
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 4);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(true);
      expect(result.description).toContain("oscillation detected");
    });

    it("should fire in default configuration (Finding C7.5-W2B2-H26)", () => {
      // Before Cycle 7.5 the default max was 3 which prevented the
      // detector from ever firing (4 entries are required for 2 direction
      // changes). With the new default of 4, an oscillating run now
      // triggers the detector.
      let state = createReviewLoop();
      expect(state.maxIterations).toBeGreaterThanOrEqual(4);
      // Findings: 5 -> 2 -> 6 -> 1 across the default iteration cap.
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 6);
      state = recordReviewIteration(state, "warning", 1);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(true);
      expect(result.description).toContain("oscillation detected");
    });
  });

  describe("detectSuppressionPatterns (Finding D7-15)", () => {
    it("returns not-found for empty / non-string input", () => {
      expect(detectSuppressionPatterns("").found).toBe(false);
      // @ts-expect-error — defensive: callers may pass undefined from a missing diff
      expect(detectSuppressionPatterns(undefined).found).toBe(false);
      expect(detectSuppressionPatterns("   \n  \n").found).toBe(false);
    });

    it("flags an `as any` cast on an added line", () => {
      const diff = ["+const x = payload as any;"].join("\n");
      const result = detectSuppressionPatterns(diff);
      expect(result.found).toBe(true);
      expect(result.hits.map((h) => h.kind)).toContain("as_any");
      expect(result.hits[0].line).toBe("const x = payload as any;");
      expect(result.description).toContain("as_any=1");
    });

    it("flags an angle-bracket `<any>` cast", () => {
      const result = detectSuppressionPatterns("+const y = <any>raw;");
      expect(result.found).toBe(true);
      expect(result.hits.map((h) => h.kind)).toContain("as_any");
    });

    it("does NOT flag identifiers that merely contain 'any' (e.g. anything, Many)", () => {
      const result = detectSuppressionPatterns("+const anything = manyValues.asString();");
      expect(result.found).toBe(false);
    });

    it("flags an eslint-disable directive with no issue reference", () => {
      const result = detectSuppressionPatterns("+// eslint-disable-next-line no-explicit-any");
      expect(result.found).toBe(true);
      expect(result.hits.map((h) => h.kind)).toContain("eslint_disable");
    });

    it("does NOT flag an eslint-disable that carries an issue reference", () => {
      const withIssue = detectSuppressionPatterns(
        "+// eslint-disable-next-line no-console -- see #1234 tracked",
      );
      expect(withIssue.found).toBe(false);
      const withUrl = detectSuppressionPatterns(
        "+/* eslint-disable no-console */ // https://example.com/issues/9",
      );
      expect(withUrl.found).toBe(false);
    });

    it("flags test.skip / it.skip / describe.skip with no linked issue", () => {
      expect(detectSuppressionPatterns("+test.skip('flaky', () => {});").found).toBe(true);
      expect(detectSuppressionPatterns("+  it.skip('todo', () => {});").found).toBe(true);
      expect(detectSuppressionPatterns("+describe.skip('suite', () => {});").found).toBe(true);
      expect(detectSuppressionPatterns("+xit('later', () => {});").found).toBe(true);
      expect(
        detectSuppressionPatterns("+test.skip('x', () => {});").hits.map((h) => h.kind),
      ).toContain("test_skip");
    });

    it("does NOT flag a skipped test that links an issue reference", () => {
      const result = detectSuppressionPatterns(
        "+test.skip('blocked on #42', () => {}); // see https://tracker/42",
      );
      expect(result.found).toBe(false);
    });

    it("scans only added lines in a unified diff (ignores context + removed lines)", () => {
      const diff = [
        "@@ -1,3 +1,3 @@",
        " const keep = value as string;",
        "-const old = value as any;",
        "+const next = value as number;",
      ].join("\n");
      // The only `as any` is on a removed line; the added line is a clean cast.
      const result = detectSuppressionPatterns(diff);
      expect(result.found).toBe(false);
    });

    it("treats a non-diff code snippet as fully added code", () => {
      const snippet = "function f() {\n  return x as any;\n}";
      const result = detectSuppressionPatterns(snippet);
      expect(result.found).toBe(true);
      expect(result.hits.map((h) => h.kind)).toContain("as_any");
    });

    it("does not flag the `+++` file header as an added line", () => {
      const diff = ["+++ b/src/foo.ts", "+const ok = value as number;"].join("\n");
      expect(detectSuppressionPatterns(diff).found).toBe(false);
    });

    it("aggregates multiple distinct suppression kinds in one diff", () => {
      const diff = [
        "+const a = x as any;",
        "+// eslint-disable-next-line no-unused-vars",
        "+it.skip('wip', () => {});",
      ].join("\n");
      const result = detectSuppressionPatterns(diff);
      expect(result.found).toBe(true);
      const kinds = new Set(result.hits.map((h) => h.kind));
      expect(kinds).toEqual(new Set(["as_any", "eslint_disable", "test_skip"]));
      expect(result.hits).toHaveLength(3);
    });
  });

  describe("monotonic_divergence escape (Finding D7-17)", () => {
    it("terminates with 'divergence' on a strictly-increasing findings series", () => {
      // Findings: 2 -> 3 -> 4 (fixer strictly worsening every pass). The
      // oscillation detector cannot see this (0 direction changes); the trend
      // escape must catch it before the iteration cap.
      let state = createReviewLoop(6);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 4);
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("divergence");
      expect(state.unresolvedFindings).toBe(4);
      // confidence on a diverging loop is the weakest signal.
      expect(state.confidence).toBe("low");
      // detectOscillation still reports no oscillation for the monotone series.
      expect(detectOscillation(state).oscillating).toBe(false);
    });

    it("the strictly-diverging [2,3,4,5] case the detail rule flags is caught", () => {
      // Mirrors the detail-rule failure-mode row: increasing Critical count
      // across passes => complexity underestimate. The loop must not run to the
      // cap; it halts on the third strictly-worse pass.
      let state = createReviewLoop(10);
      state = recordReviewIteration(state, "critical", 2);
      state = recordReviewIteration(state, "critical", 3);
      expect(state.terminated).toBe(false); // two entries: not yet divergent
      state = recordReviewIteration(state, "critical", 4);
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("divergence");
      // currentIteration stopped at 3, well below the cap of 10.
      expect(state.currentIteration).toBe(3);
    });

    it("requires MIN_DIVERGENCE_HISTORY entries before firing", () => {
      // A single uptick after one pass (2 -> 3) must NOT abort the loop — only a
      // persistent strictly-increasing run of MIN_DIVERGENCE_HISTORY does.
      let state = createReviewLoop(6);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 3);
      expect(MIN_DIVERGENCE_HISTORY).toBe(3);
      expect(state.terminated).toBe(false);
      expect(state.terminationReason).toBeUndefined();
    });

    it("does not fire when an early decrease breaks the monotone run", () => {
      // 5 -> 2 -> 6 is not strictly increasing over the last 3 entries (2 < 5),
      // so divergence does not fire; the loop continues.
      let state = createReviewLoop(6);
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 6);
      expect(state.terminated).toBe(false);
    });

    it("a clean verdict still wins over divergence on the same pass", () => {
      // Even if the prior two passes were rising, a clean verdict (0 findings)
      // is a decrease, breaks the monotone run, and terminates as 'clean'.
      let state = createReviewLoop(6);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.terminationReason).toBe("clean");
    });

    it("reviewLoopSummary surfaces the complexity-underestimate recommendation", () => {
      let state = createReviewLoop(6);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 4);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain(DIVERGENCE_MESSAGE);
      expect(summary).toContain("confidence: low");
    });
  });

  describe("CALIBRATION (Finding C7.5-W2B2-H25)", () => {
    it("exposes a reproducible calibration record rather than a free-text comment", () => {
      expect(CALIBRATION).toBeDefined();
      expect(typeof CALIBRATION.basis).toBe("string");
      expect(["measured", "informed_estimate"]).toContain(CALIBRATION.basis);
      expect(typeof CALIBRATION.source).toBe("string");
      expect(CALIBRATION.source.length).toBeGreaterThan(0);
      expect(typeof CALIBRATION.sampleSize).toBe("number");
      expect(typeof CALIBRATION.measurementMethodRef).toBe("string");
    });

    it("exposes the claimed iteration-split distribution as structured data", () => {
      const s = CALIBRATION.split;
      expect(s.iteration1CleanRate).toBeCloseTo(0.78, 2);
      expect(s.iteration2CleanRate).toBeCloseTo(0.18, 2);
      expect(s.iteration3CleanRate).toBeCloseTo(0.04, 2);
      expect(s.iteration4PlusRate).toBeCloseTo(0.0, 2);
      const total =
        s.iteration1CleanRate +
        s.iteration2CleanRate +
        s.iteration3CleanRate +
        s.iteration4PlusRate;
      expect(total).toBeCloseTo(1.0, 2);
    });

    it("exposes measurable recalibration triggers", () => {
      const t = CALIBRATION.recalibrationTriggers;
      expect(t.iteration1CleanRateBelow).toBeGreaterThan(0);
      expect(t.iteration1CleanRateBelow).toBeLessThan(1);
      expect(t.oscillationRateAbove).toBeGreaterThan(0);
      expect(t.oscillationRateAbove).toBeLessThan(1);
    });

    it("is frozen to prevent runtime mutation of the claim", () => {
      expect(() => {
        // @ts-expect-error: intentional runtime mutation attempt
        CALIBRATION.basis = "measured";
      }).toThrow();
      expect(() => {
        // @ts-expect-error: nested readonly
        CALIBRATION.split.iteration1CleanRate = 0.99;
      }).toThrow();
    });

    it("declares measurement basis as informed_estimate until telemetry lands", () => {
      // The finding downgrades the claim pending per-finding iteration-count
      // telemetry. When telemetry ships, flipping basis to "measured" and
      // updating sampleSize + measuredAt is the explicit promotion path.
      expect(CALIBRATION.basis).toBe("informed_estimate");
      expect(CALIBRATION.sampleSize).toBe(0);
      expect(CALIBRATION.measuredAt).toBeNull();
    });
  });

  describe("loop-class taxonomy (Findings D5-SA5.4-03 / D8-SA8.3-02)", () => {
    it("ships the class caps as a typed export: code = DEFAULT - 1 (3), spec/default = DEFAULT (4)", () => {
      expect(REVIEW_LOOP_CLASS_CAPS.code).toBe(DEFAULT_MAX_REVIEW_ITERATIONS - 1);
      expect(REVIEW_LOOP_CLASS_CAPS.code).toBe(3);
      expect(REVIEW_LOOP_CLASS_CAPS.spec).toBe(DEFAULT_MAX_REVIEW_ITERATIONS);
      expect(REVIEW_LOOP_CLASS_CAPS.default).toBe(DEFAULT_MAX_REVIEW_ITERATIONS);
      expect(REVIEW_LOOP_CLASS_CAPS.default).toBe(4);
    });

    it("maxIterationsForClass returns the record value for every class", () => {
      const classes: ReviewLoopClass[] = ["code", "spec", "default"];
      for (const loopClass of classes) {
        expect(maxIterationsForClass(loopClass)).toBe(REVIEW_LOOP_CLASS_CAPS[loopClass]);
      }
    });

    it("every class cap is a valid createReviewLoop bound (within [MIN, HARD])", () => {
      for (const cap of Object.values(REVIEW_LOOP_CLASS_CAPS)) {
        expect(cap).toBeGreaterThanOrEqual(MIN_MAX_REVIEW_ITERATIONS);
        expect(cap).toBeLessThanOrEqual(HARD_MAX_REVIEW_ITERATIONS);
      }
    });

    it("the code-class opt-down flows through createReviewLoop unclamped", () => {
      const state = createReviewLoop(maxIterationsForClass("code"));
      expect(state.maxIterations).toBe(3);
    });

    it("the state model itself has no class branch — default stays DEFAULT_MAX_REVIEW_ITERATIONS (Finding D8-SA8.3-02)", () => {
      // The −1 is an explicit caller opt-down, never an implicit code branch:
      // a default-constructed loop runs to 4, matching the reviewer/fixer
      // agents ("After 4 review-fix cycles") and canContinueReview.
      expect(createReviewLoop().maxIterations).toBe(DEFAULT_MAX_REVIEW_ITERATIONS);
    });

    it("REVIEW_LOOP_CLASS_CAPS is frozen", () => {
      expect(Object.isFrozen(REVIEW_LOOP_CLASS_CAPS)).toBe(true);
    });
  });

  describe("iteration ledger (Finding D7-SA7.2-01 — CL-2 telemetry)", () => {
    /** Terminate a loop clean at exactly `iteration` (max 6, decreasing findings). */
    const cleanAt = (iteration: number) => {
      let state = createReviewLoop(6);
      for (let i = 1; i < iteration; i++) {
        state = recordReviewIteration(state, "warning", 6 - i);
      }
      return recordReviewIteration(state, "clean", 0);
    };

    /** Synthetic ledger entry with the given terminal shape. */
    const entryWith = (
      terminationReason: ReviewLoopTerminationReason,
      iterationCount: number,
    ): ReviewLoopLedgerEntry => ({
      recordedAt: "2026-07-11T00:00:00.000Z",
      loopClass: "code",
      maxIterations: 3,
      iterationCount,
      terminationReason,
      verdictByIteration: [],
      source: "test-synthetic",
      converged: terminationReason === "clean",
    });

    it("REVIEW_LOOP_TERMINATION_REASONS enumerates all seven terminal reasons at runtime", () => {
      expect(REVIEW_LOOP_TERMINATION_REASONS).toHaveLength(7);
      expect(REVIEW_LOOP_TERMINATION_REASONS).toContain("clean");
      expect(REVIEW_LOOP_TERMINATION_REASONS).toContain("max_iterations");
      expect(REVIEW_LOOP_TERMINATION_REASONS).toContain("divergence");
    });

    it("reviewLoopLedgerEntry captures the terminal loop shape", () => {
      const state = cleanAt(2);
      const entry = reviewLoopLedgerEntry(state, {
        loopClass: "code",
        source: "D7-SA7.2-01",
        recordedAt: "2026-07-11T00:00:00.000Z",
      });
      expect(entry).toMatchObject({
        recordedAt: "2026-07-11T00:00:00.000Z",
        loopClass: "code",
        maxIterations: 6,
        iterationCount: 2,
        terminationReason: "clean",
        verdictByIteration: ["warning", "clean"],
        source: "D7-SA7.2-01",
        converged: true,
      });
      // durationMs is derived from the loop's own history timestamps (U10) —
      // assert shape, never an exact wall-clock value (repo clock convention).
      expect(Number.isInteger(entry.durationMs)).toBe(true);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("converged is false for every non-clean termination (U10)", () => {
      let state = createReviewLoop(2);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 2);
      expect(state.terminationReason).toBe("max_iterations");
      const entry = reviewLoopLedgerEntry(state, { loopClass: "code", source: "t" });
      expect(entry.converged).toBe(false);
    });

    it("durationMs spans first-to-last history timestamps and is omitted without history (U10)", () => {
      // Synthetic terminated state with explicit timestamps — deterministic
      // duration with no wall-clock dependence.
      const timed = {
        ...cleanAt(2),
        history: [
          {
            iteration: 1,
            verdict: "warning" as const,
            findingsCount: 2,
            timestamp: "2026-07-11T00:00:00.000Z",
          },
          {
            iteration: 2,
            verdict: "clean" as const,
            findingsCount: 0,
            timestamp: "2026-07-11T00:00:10.000Z",
          },
        ],
      };
      const entry = reviewLoopLedgerEntry(timed, { loopClass: "code", source: "t" });
      expect(entry.durationMs).toBe(10_000);

      // No history (manual termination before iteration 1) → field omitted,
      // never a fabricated 0.
      const bare = terminateReviewLoop(createReviewLoop(3));
      const bareEntry = reviewLoopLedgerEntry(bare, { loopClass: "code", source: "t" });
      expect(bareEntry.durationMs).toBeUndefined();

      // Unparseable timestamp → field omitted.
      const corrupt = {
        ...timed,
        history: [{ ...timed.history[0], timestamp: "not-a-date" }],
      };
      const corruptEntry = reviewLoopLedgerEntry(corrupt, {
        loopClass: "code",
        source: "t",
      });
      expect(corruptEntry.durationMs).toBeUndefined();
    });

    it("reviewLoopLedgerEntry defaults recordedAt to now (ISO-8601)", () => {
      const entry = reviewLoopLedgerEntry(cleanAt(1), {
        loopClass: "default",
        source: "test",
      });
      expect(new Date(entry.recordedAt).toISOString()).toBe(entry.recordedAt);
    });

    it("throws HatchError for a non-terminated loop (an in-progress loop has no final count)", () => {
      const inProgress = createReviewLoop(3);
      expect(() =>
        reviewLoopLedgerEntry(inProgress, { loopClass: "code", source: "test" }),
      ).toThrow(HatchError);
      expect(() =>
        reviewLoopLedgerEntry(inProgress, { loopClass: "code", source: "test" }),
      ).toThrow(/non-terminated/);
    });

    it("serialize -> parse round-trips an entry through the JSONL form", () => {
      const entry = reviewLoopLedgerEntry(cleanAt(3), {
        loopClass: "spec",
        source: "round-trip",
        recordedAt: "2026-07-11T00:00:00.000Z",
      });
      const line = serializeReviewLoopLedgerEntry(entry);
      expect(line).not.toContain("\n");
      expect(parseReviewLoopLedger(line)).toEqual([entry]);
    });

    it("parseReviewLoopLedger skips blank lines and trailing newlines", () => {
      const entry = entryWith("clean", 1);
      const content = `\n${serializeReviewLoopLedgerEntry(entry)}\n\n`;
      expect(parseReviewLoopLedger(content)).toHaveLength(1);
      expect(parseReviewLoopLedger("")).toEqual([]);
      expect(parseReviewLoopLedger("\n\n")).toEqual([]);
    });

    it("parseReviewLoopLedger names the 1-based line number on invalid JSON", () => {
      const good = serializeReviewLoopLedgerEntry(entryWith("clean", 1));
      expect(() => parseReviewLoopLedger(`${good}\n{not json`)).toThrow(HatchError);
      expect(() => parseReviewLoopLedger(`${good}\n{not json`)).toThrow(/line 2/);
    });

    it("parseReviewLoopLedger rejects out-of-domain fields, naming the field", () => {
      const base = entryWith("clean", 1);
      const withField = (patch: Record<string, unknown>): string =>
        JSON.stringify({ ...base, ...patch });
      expect(() => parseReviewLoopLedger(withField({ loopClass: "prose" }))).toThrow(
        /loopClass/,
      );
      expect(() =>
        parseReviewLoopLedger(withField({ terminationReason: "gave_up" })),
      ).toThrow(/terminationReason/);
      expect(() =>
        parseReviewLoopLedger(withField({ verdictByIteration: ["APPROVE"] })),
      ).toThrow(/verdictByIteration/);
      expect(() => parseReviewLoopLedger(withField({ iterationCount: -1 }))).toThrow(
        /iterationCount/,
      );
      expect(() => parseReviewLoopLedger(withField({ source: "" }))).toThrow(/source/);
      expect(() => parseReviewLoopLedger("42")).toThrow(/must be a JSON object/);
    });

    it("parses pre-U10 lines without converged/durationMs, deriving converged (back-compat)", () => {
      const legacy: Record<string, unknown> = { ...entryWith("clean", 1) };
      delete legacy.converged;
      const [parsed] = parseReviewLoopLedger(JSON.stringify(legacy));
      expect(parsed.converged).toBe(true);
      expect(parsed.durationMs).toBeUndefined();

      const legacyTail: Record<string, unknown> = { ...entryWith("divergence", 3) };
      delete legacyTail.converged;
      const [parsedTail] = parseReviewLoopLedger(JSON.stringify(legacyTail));
      expect(parsedTail.converged).toBe(false);
    });

    it("rejects a converged value that contradicts terminationReason (U10)", () => {
      const base = entryWith("max_iterations", 3);
      const inconsistent = JSON.stringify({ ...base, converged: true });
      expect(() => parseReviewLoopLedger(inconsistent)).toThrow(HatchError);
      expect(() => parseReviewLoopLedger(inconsistent)).toThrow(/converged/);
      const wrongType = JSON.stringify({ ...base, converged: "yes" });
      expect(() => parseReviewLoopLedger(wrongType)).toThrow(/converged/);
    });

    it("rejects an out-of-domain durationMs, passing a valid one through (U10)", () => {
      const base = entryWith("clean", 1);
      expect(() =>
        parseReviewLoopLedger(JSON.stringify({ ...base, durationMs: -1 })),
      ).toThrow(/durationMs/);
      expect(() =>
        parseReviewLoopLedger(JSON.stringify({ ...base, durationMs: 1.5 })),
      ).toThrow(/durationMs/);
      expect(() =>
        parseReviewLoopLedger(JSON.stringify({ ...base, durationMs: "fast" })),
      ).toThrow(/durationMs/);
      const [parsed] = parseReviewLoopLedger(
        JSON.stringify({ ...base, durationMs: 4200 }),
      );
      expect(parsed.durationMs).toBe(4200);
    });

    it("deriveIterationSplit on an empty ledger reports zero sample, not a fabricated split", () => {
      const derived = deriveIterationSplit([]);
      expect(derived.sampleSize).toBe(0);
      expect(derived.promotable).toBe(false);
      expect(derived.split.iteration1CleanRate).toBe(0);
      expect(derived.split.iteration4PlusRate).toBe(0);
    });

    it("buckets clean terminations by iteration and sums rates to 1", () => {
      const entries = [
        entryWith("clean", 1),
        entryWith("clean", 1),
        entryWith("clean", 2),
        entryWith("clean", 3),
        entryWith("max_iterations", 4),
        entryWith("divergence", 3),
      ];
      const { split, sampleSize } = deriveIterationSplit(entries);
      expect(sampleSize).toBe(6);
      expect(split.iteration1CleanRate).toBeCloseTo(2 / 6, 10);
      expect(split.iteration2CleanRate).toBeCloseTo(1 / 6, 10);
      expect(split.iteration3CleanRate).toBeCloseTo(1 / 6, 10);
      expect(split.iteration4PlusRate).toBeCloseTo(2 / 6, 10);
      const total =
        split.iteration1CleanRate +
        split.iteration2CleanRate +
        split.iteration3CleanRate +
        split.iteration4PlusRate;
      expect(total).toBeCloseTo(1.0, 10);
    });

    it("a clean termination at iteration >= 4 lands in the oscillation-prone tail", () => {
      const { split } = deriveIterationSplit([entryWith("clean", 4)]);
      expect(split.iteration4PlusRate).toBe(1);
      expect(split.iteration3CleanRate).toBe(0);
    });

    it("every non-clean termination lands in the tail regardless of iteration count", () => {
      const { split } = deriveIterationSplit([
        entryWith("oscillation", 2),
        entryWith("cost_budget_exceeded", 1),
      ]);
      expect(split.iteration4PlusRate).toBe(1);
      expect(split.iteration1CleanRate).toBe(0);
    });

    it("promotable flips at CALIBRATION_SAMPLE_THRESHOLD (the CL-2 promotion gate)", () => {
      expect(CALIBRATION_SAMPLE_THRESHOLD).toBe(30);
      const below = deriveIterationSplit(
        Array.from({ length: CALIBRATION_SAMPLE_THRESHOLD - 1 }, () =>
          entryWith("clean", 1),
        ),
      );
      expect(below.promotable).toBe(false);
      const atThreshold = deriveIterationSplit(
        Array.from({ length: CALIBRATION_SAMPLE_THRESHOLD }, () => entryWith("clean", 1)),
      );
      expect(atThreshold.promotable).toBe(true);
    });
  });

  describe("runtime telemetry append (Findings D7-SA7.2-01/-04 — CL-2 unit U10)", () => {
    const tmpRoots: string[] = [];
    const makeRoot = async (): Promise<string> => {
      const root = await mkdtemp(join(tmpdir(), "hatch3r-rlt-"));
      tmpRoots.push(root);
      return root;
    };
    afterEach(async () => {
      await Promise.all(
        tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
      );
    });

    /** Terminated-clean loop after `n` iterations under a cap of 6. */
    const terminatedClean = (n: number) => {
      let state = createReviewLoop(6);
      for (let i = 1; i < n; i++) {
        state = recordReviewIteration(state, "warning", 6 - i);
      }
      return recordReviewIteration(state, "clean", 0);
    };

    it("writes one parseable JSONL record to .hatch3r/review-loop-metrics.jsonl at loop exit", async () => {
      const root = await makeRoot();
      const state = terminatedClean(2);
      const result = await appendReviewLoopTelemetry(root, state, {
        loopClass: "code",
        source: "u10-test",
        recordedAt: "2026-07-12T00:00:00.000Z",
      });
      expect(result.written).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(result.path).toBe(join(root, REVIEW_LOOP_METRICS_RELPATH));
      const content = await readFile(result.path, "utf-8");
      expect(content.endsWith("\n")).toBe(true);
      const entries = parseReviewLoopLedger(content);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        recordedAt: "2026-07-12T00:00:00.000Z",
        loopClass: "code",
        iterationCount: 2,
        terminationReason: "clean",
        converged: true,
        source: "u10-test",
      });
    });

    it("appends accumulate — records are added, never replaced", async () => {
      const root = await makeRoot();
      const first = await appendReviewLoopTelemetry(root, terminatedClean(1), {
        loopClass: "spec",
        source: "run-1",
      });
      const second = await appendReviewLoopTelemetry(root, terminatedClean(3), {
        loopClass: "code",
        source: "run-2",
      });
      expect(first.written).toBe(true);
      expect(second.written).toBe(true);
      const entries = parseReviewLoopLedger(
        await readFile(join(root, REVIEW_LOOP_METRICS_RELPATH), "utf-8"),
      );
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.source)).toEqual(["run-1", "run-2"]);
    });

    it("a telemetry write failure never throws and never alters the loop outcome", async () => {
      const root = await makeRoot();
      // Occupy the .hatch3r path with a FILE so mkdir/append must fail.
      await writeFile(join(root, ".hatch3r"), "not a directory", "utf-8");
      const state = terminatedClean(2);
      const before = JSON.parse(JSON.stringify(state)) as unknown;
      const result = await appendReviewLoopTelemetry(root, state, {
        loopClass: "code",
        source: "u10-failure",
      });
      expect(result.written).toBe(false);
      expect(result.warning).toContain("NOT persisted");
      expect(result.warning).toContain(result.path);
      // Loop state is read-only input: outcome unchanged by the failed write.
      expect(JSON.parse(JSON.stringify(state))).toEqual(before);
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("clean");
    });

    it("a non-terminated loop is reported as a warning, not thrown (failure isolation)", async () => {
      const root = await makeRoot();
      const inProgress = createReviewLoop(3);
      const result = await appendReviewLoopTelemetry(root, inProgress, {
        loopClass: "code",
        source: "u10-in-progress",
      });
      expect(result.written).toBe(false);
      expect(result.warning).toContain("non-terminated");
      expect(existsSync(join(root, REVIEW_LOOP_METRICS_RELPATH))).toBe(false);
    });
  });

  describe("runtime enforcement (Finding C7.5-W2B2-H40)", () => {
    describe("enforceReviewIteration", () => {
      it("returns allowed=true while under the iteration cap", () => {
        const initial = createReviewLoop(3);
        const result = enforceReviewIteration(initial, "warning", 5);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(result.state.currentIteration).toBe(1);
        expect(result.state.history).toHaveLength(1);
      });

      it("returns allowed=false with clean verdict termination", () => {
        const initial = createReviewLoop(3);
        const result = enforceReviewIteration(initial, "clean", 0);
        expect(result.allowed).toBe(false);
        expect(result.state.terminated).toBe(true);
        expect(result.state.terminationReason).toBe("clean");
      });

      it("returns allowed=false when the iteration cap is reached", () => {
        let state = createReviewLoop(2);
        const first = enforceReviewIteration(state, "warning", 3);
        expect(first.allowed).toBe(true);
        state = first.state;
        const second = enforceReviewIteration(state, "warning", 2);
        expect(second.allowed).toBe(false);
        expect(second.state.terminated).toBe(true);
        expect(second.state.terminationReason).toBe("max_iterations");
      });

      it("returns allowed=false without advancing when already terminated", () => {
        let state = createReviewLoop(3);
        state = recordReviewIteration(state, "clean", 0);
        const result = enforceReviewIteration(state, "warning", 5);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("already_terminated");
        expect(result.state).toBe(state);
      });

      it("returns allowed=false with reason when invoked past the cap", () => {
        // Manufacture a state where the loop is not marked terminated but
        // currentIteration has hit maxIterations (can happen if a caller
        // mutates state outside recordReviewIteration).
        let state = createReviewLoop(1);
        state = recordReviewIteration(state, "warning", 3);
        // After 1 iteration with max=1, state is terminated with max_iterations.
        // Reset the terminated flag to exercise the canContinueReview branch.
        const forced: typeof state = { ...state, terminated: false };
        const result = enforceReviewIteration(forced, "warning", 3);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("max_iterations_exceeded");
      });
    });

    describe("assertReviewIterationAllowed", () => {
      it("does not throw for a fresh loop", () => {
        const state = createReviewLoop(3);
        expect(() => assertReviewIterationAllowed(state)).not.toThrow();
      });

      it("throws HatchError when the loop is already terminated", () => {
        let state = createReviewLoop(3);
        state = recordReviewIteration(state, "clean", 0);
        expect(() => assertReviewIterationAllowed(state)).toThrow(HatchError);
        expect(() => assertReviewIterationAllowed(state)).toThrow(
          /already terminated/,
        );
      });

      it("throws HatchError when the loop is at max iterations", () => {
        let state = createReviewLoop(1);
        state = recordReviewIteration(state, "warning", 3);
        // State is terminated due to max-iterations; un-terminate to test
        // the "at max, not yet terminated" branch.
        const forced: typeof state = { ...state, terminated: false };
        expect(() => assertReviewIterationAllowed(forced)).toThrow(HatchError);
        expect(() => assertReviewIterationAllowed(forced)).toThrow(
          /maximum iterations/,
        );
      });

      it("throw includes CALIBRATION reference so operators can find the default's basis", () => {
        let state = createReviewLoop(1);
        state = recordReviewIteration(state, "warning", 3);
        const forced: typeof state = { ...state, terminated: false };
        expect(() => assertReviewIterationAllowed(forced)).toThrow(
          /CALIBRATION/,
        );
      });
    });

    it("enforceReviewIteration is usable as the per-iteration production gate", () => {
      // Simulates the orchestrator production path invoking the enforcement
      // function at every iteration. The loop must terminate within
      // maxIterations without any external bookkeeping.
      let state = createReviewLoop(3);
      const verdicts: Array<{ verdict: ReviewIterationVerdict; findings: number }> = [
        { verdict: "critical", findings: 8 },
        { verdict: "warning", findings: 4 },
        { verdict: "warning", findings: 3 },
      ];
      let allowedCount = 0;
      for (const v of verdicts) {
        const r = enforceReviewIteration(state, v.verdict, v.findings);
        state = r.state;
        if (r.allowed) allowedCount++;
        else break;
      }
      // Max was 3 so all 3 iterations run; the final one ends with
      // max_iterations and allowed=false.
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("max_iterations");
      expect(allowedCount).toBeLessThanOrEqual(state.maxIterations);
    });
  });
});

describe("evaluateReviewGate (C8-D13-M1)", () => {
  const clean = { critical: 0, warning: 0, suggestion: 0 };

  it("passes on clean verdict with high confidence", () => {
    const r = evaluateReviewGate({ severityCount: clean, confidence: "high", iterationBudgetRemaining: 2 });
    expect(r.decision).toBe("pass");
  });
  it("passes on clean verdict with medium confidence", () => {
    const r = evaluateReviewGate({ severityCount: clean, confidence: "medium", iterationBudgetRemaining: 2 });
    expect(r.decision).toBe("pass");
  });
  it("second_pass on clean + low confidence + budget remaining", () => {
    const r = evaluateReviewGate({ severityCount: clean, confidence: "low", iterationBudgetRemaining: 1 });
    expect(r.decision).toBe("second_pass");
  });
  it("escalates on clean + low confidence + budget exhausted", () => {
    const r = evaluateReviewGate({ severityCount: clean, confidence: "low", iterationBudgetRemaining: 0 });
    expect(r.decision).toBe("escalate");
  });
  it("escalates on clean + unknown confidence + budget exhausted", () => {
    const r = evaluateReviewGate({ severityCount: clean, confidence: "unknown", iterationBudgetRemaining: 0 });
    expect(r.decision).toBe("escalate");
  });
  it("fails when critical findings exist", () => {
    const r = evaluateReviewGate({ severityCount: { critical: 1, warning: 0, suggestion: 0 }, confidence: "high", iterationBudgetRemaining: 5 });
    expect(r.decision).toBe("fail");
    expect(r.reason).toContain("Critical");
  });
  it("fails when warning findings exist", () => {
    const r = evaluateReviewGate({ severityCount: { critical: 0, warning: 2, suggestion: 0 }, confidence: "high", iterationBudgetRemaining: 5 });
    expect(r.decision).toBe("fail");
    expect(r.reason).toContain("Warning");
  });
  it("fails on NaN severity counts", () => {
    const r = evaluateReviewGate({ severityCount: { critical: NaN, warning: 0, suggestion: 0 }, confidence: "high", iterationBudgetRemaining: 5 });
    expect(r.decision).toBe("fail");
    expect(r.reason).toContain("malformed");
  });
  it("fails on Infinity severity counts", () => {
    const r = evaluateReviewGate({ severityCount: { critical: 0, warning: Infinity, suggestion: 0 }, confidence: "high", iterationBudgetRemaining: 5 });
    expect(r.decision).toBe("fail");
  });
  it("fails on negative severity counts", () => {
    const r = evaluateReviewGate({ severityCount: { critical: -1, warning: 0, suggestion: 0 }, confidence: "high", iterationBudgetRemaining: 5 });
    expect(r.decision).toBe("fail");
  });
  it("returns non-empty reason on every path", () => {
    const paths: Array<Parameters<typeof evaluateReviewGate>[0]> = [
      { severityCount: clean, confidence: "high", iterationBudgetRemaining: 2 },
      { severityCount: clean, confidence: "low", iterationBudgetRemaining: 1 },
      { severityCount: clean, confidence: "low", iterationBudgetRemaining: 0 },
      { severityCount: { critical: 1, warning: 0, suggestion: 0 }, confidence: "high", iterationBudgetRemaining: 5 },
    ];
    for (const p of paths) {
      const r = evaluateReviewGate(p);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
  it("treats unknown confidence like low", () => {
    const r = evaluateReviewGate({ severityCount: clean, confidence: "unknown", iterationBudgetRemaining: 1 });
    expect(r.decision).toBe("second_pass");
  });

  describe("D15-M8: verdict independence", () => {
    it("defaults verdictIndependence to 'unknown' when omitted", () => {
      const r = evaluateReviewGate({ severityCount: clean, confidence: "high", iterationBudgetRemaining: 2 });
      expect(r.verdictIndependence).toBe("unknown");
    });

    it("echoes verdictIndependence='different_family' on pass without same-family advisory", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 2,
        verdictIndependence: "different_family",
      });
      expect(r.decision).toBe("pass");
      expect(r.verdictIndependence).toBe("different_family");
      expect(r.reason).not.toContain("share a model family");
    });

    it("annotates pass reason when verdictIndependence='same_family' (D15-M8 limitation surfaced)", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 2,
        verdictIndependence: "same_family",
      });
      expect(r.decision).toBe("pass");
      expect(r.reason).toContain("share a model family");
    });

    it("annotates pass reason on 'unknown' independence (default) — flags unattested gate", () => {
      const r = evaluateReviewGate({ severityCount: clean, confidence: "high", iterationBudgetRemaining: 2 });
      expect(r.reason).toContain("verdict independence not declared");
    });
  });

  describe("D13-3: confidence floor (D13-SA13.3-F13.3.3)", () => {
    // The four core orchestrators document a `--confidence-floor` knob that
    // tightens the clean-verdict gate; before D13-3 `ReviewGateInput` carried
    // no `confidenceFloor` field so the gate could not express the behaviour
    // the command bodies describe. This matrix pins the decision for every
    // floor × confidence cell with iteration budget remaining (so the
    // below-floor path resolves to second_pass, not escalate).
    type Floor = "any" | "medium" | "high";
    type Conf = "high" | "medium" | "low" | "unknown";
    const cell = (floor: Floor, confidence: Conf) =>
      evaluateReviewGate({
        severityCount: clean,
        confidence,
        iterationBudgetRemaining: 2,
        confidenceFloor: floor,
      });

    // [floor, confidence, expected decision with budget remaining]
    const MATRIX: ReadonlyArray<[Floor, Conf, "pass" | "second_pass"]> = [
      // floor "any" — pre-D13-3 behaviour: high/medium pass, low/unknown retry
      ["any", "high", "pass"],
      ["any", "medium", "pass"],
      ["any", "low", "second_pass"],
      ["any", "unknown", "second_pass"],
      // floor "medium" — same decision surface as "any" at the aggregate input
      ["medium", "high", "pass"],
      ["medium", "medium", "pass"],
      ["medium", "low", "second_pass"],
      ["medium", "unknown", "second_pass"],
      // floor "high" — medium no longer passes; only high passes
      ["high", "high", "pass"],
      ["high", "medium", "second_pass"],
      ["high", "low", "second_pass"],
      ["high", "unknown", "second_pass"],
    ];

    for (const [floor, confidence, expected] of MATRIX) {
      it(`floor "${floor}" + confidence "${confidence}" -> ${expected}`, () => {
        const r = cell(floor, confidence);
        expect(r.decision).toBe(expected);
        // Every gate result echoes the floor it evaluated under.
        expect(r.reason).toContain(`floor "${floor}"`);
      });
    }

    it("defaults to floor 'any' when confidenceFloor is omitted (backward compatible)", () => {
      // medium confidence passes under the default floor exactly as it did
      // before D13-3 added the field.
      const omitted = evaluateReviewGate({
        severityCount: clean,
        confidence: "medium",
        iterationBudgetRemaining: 2,
      });
      const explicitAny = cell("any", "medium");
      expect(omitted.decision).toBe("pass");
      expect(omitted.decision).toBe(explicitAny.decision);
      expect(omitted.reason).toContain('floor "any"');
    });

    it("floor 'high' tightens medium to second_pass — the distinct D13-3 behaviour", () => {
      // The single cell that differs between floor "any"/"medium" and "high":
      // a clean verdict at medium confidence is acceptable under the looser
      // floors but forces another reviewer pass under "high".
      expect(cell("any", "medium").decision).toBe("pass");
      expect(cell("medium", "medium").decision).toBe("pass");
      expect(cell("high", "medium").decision).toBe("second_pass");
    });

    it("floor 'high' + medium confidence escalates when iteration budget is exhausted", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "medium",
        iterationBudgetRemaining: 0,
        confidenceFloor: "high",
      });
      expect(r.decision).toBe("escalate");
      expect(r.reason).toContain('floor "high"');
    });

    it("the floor never relaxes the Critical/Warning fail gates", () => {
      // Even at the loosest floor, a Warning still fails; the floor only adds
      // second-pass pressure on otherwise-clean verdicts.
      const r = evaluateReviewGate({
        severityCount: { critical: 0, warning: 1, suggestion: 0 },
        confidence: "high",
        iterationBudgetRemaining: 5,
        confidenceFloor: "any",
      });
      expect(r.decision).toBe("fail");
      expect(r.reason).toContain("Warning");
    });
  });

  describe("D13-21: confidence reconciliation (min(reviewLoopConfidence, selfAssigned))", () => {
    it("caps an over-confident self-rating with the lower deterministic signal", () => {
      // self-assigned "high" but the iteration-derived signal is "low" — the
      // floor must evaluate against "low", forcing a second pass.
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        reviewLoopConfidence: "low",
        iterationBudgetRemaining: 2,
      });
      expect(r.decision).toBe("second_pass");
      expect(r.effectiveConfidence).toBe("low");
      expect(r.reason).toContain("min(reviewLoopConfidence");
    });

    it("does not raise confidence above the self-assigned value", () => {
      // self-assigned "low", deterministic "high" — the worse (low) still wins,
      // so an under-confident reviewer is never overridden upward.
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "low",
        reviewLoopConfidence: "high",
        iterationBudgetRemaining: 2,
      });
      expect(r.decision).toBe("second_pass");
      expect(r.effectiveConfidence).toBe("low");
    });

    it("passes when both signals agree on high", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        reviewLoopConfidence: "high",
        iterationBudgetRemaining: 2,
      });
      expect(r.decision).toBe("pass");
      expect(r.effectiveConfidence).toBe("high");
    });

    it("uses the self-assigned value unchanged when reviewLoopConfidence is omitted (pre-D13-21)", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 2,
      });
      expect(r.decision).toBe("pass");
      expect(r.effectiveConfidence).toBe("high");
      expect(r.reason).not.toContain("min(reviewLoopConfidence");
    });

    it("the reconciled signal interacts with the high floor", () => {
      // deterministic "medium" caps self-assigned "high" to "medium"; under the
      // "high" floor medium no longer passes.
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        reviewLoopConfidence: "medium",
        confidenceFloor: "high",
        iterationBudgetRemaining: 2,
      });
      expect(r.effectiveConfidence).toBe("medium");
      expect(r.decision).toBe("second_pass");
    });
  });

  describe("D7-18 / D13-16 / D15-20: provider-independence gating on security diffs", () => {
    it("forces second_pass on a clean same_family verdict for a security-touching diff", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 2,
        verdictIndependence: "same_family",
        securityTouchingDiff: true,
      });
      expect(r.decision).toBe("second_pass");
      expect(r.reason).toContain("security-touching diff");
      expect(r.reason).toContain("not provider-independent");
    });

    it("forces second_pass on a clean unknown-independence verdict for a security-touching diff", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 2,
        // verdictIndependence omitted -> "unknown"
        securityTouchingDiff: true,
      });
      expect(r.decision).toBe("second_pass");
      expect(r.verdictIndependence).toBe("unknown");
    });

    it("escalates when a security-touching non-independent verdict has no iteration budget", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 0,
        verdictIndependence: "same_family",
        securityTouchingDiff: true,
      });
      expect(r.decision).toBe("escalate");
      expect(r.reason).toContain("security-touching diff");
    });

    it("passes a clean different_family verdict on a security-touching diff (already independent)", () => {
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 2,
        verdictIndependence: "different_family",
        securityTouchingDiff: true,
      });
      expect(r.decision).toBe("pass");
    });

    it("leaves non-security same_family verdicts as pass (everyday-review path unchanged)", () => {
      // securityTouchingDiff defaults to false -> the pre-Cycle-11 advisory-only
      // behaviour for same_family is preserved.
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        iterationBudgetRemaining: 2,
        verdictIndependence: "same_family",
      });
      expect(r.decision).toBe("pass");
      expect(r.reason).toContain("share a model family");
    });

    it("Critical findings still fail regardless of securityTouchingDiff", () => {
      const r = evaluateReviewGate({
        severityCount: { critical: 1, warning: 0, suggestion: 0 },
        confidence: "high",
        iterationBudgetRemaining: 2,
        verdictIndependence: "same_family",
        securityTouchingDiff: true,
      });
      expect(r.decision).toBe("fail");
    });

    it("combines with reconciliation: a low effective confidence below floor takes the standard second_pass path", () => {
      // When the verdict is already below floor, the standard below-floor
      // second_pass fires; the security-independence branch only applies to
      // otherwise-passing verdicts.
      const r = evaluateReviewGate({
        severityCount: clean,
        confidence: "high",
        reviewLoopConfidence: "low",
        iterationBudgetRemaining: 2,
        verdictIndependence: "same_family",
        securityTouchingDiff: true,
      });
      expect(r.decision).toBe("second_pass");
      expect(r.effectiveConfidence).toBe("low");
      // below-floor reason, not the security-independence reason
      expect(r.reason).toContain("below floor");
    });
  });
});

describe("confidenceExplanation rule parity (Finding D13-2 / D13-SA13.2-F2)", () => {
  // Before D13-2 the three confidence-to-action strings were reachable only
  // from a unit test — referenced by zero prompt artifacts, emitted to no user.
  // The fix moved the canonical text into the user-facing iteration-summary
  // rule (the §5 Confidence-line guidance every orchestrator appends). This
  // guard asserts the typed accessor stays byte-identical to the rule body, so
  // the strings can never silently drift apart or fall back to test-only reach.
  const repoRoot = process.cwd();
  const levels: ReviewConfidenceLevel[] = ["high", "medium", "low"];

  it.each(["rules/hatch3r-iteration-summary.md", "rules/hatch3r-iteration-summary.mdc"])(
    "%s contains every confidenceExplanation string verbatim under the Confidence-to-Action Mapping section",
    (rulePath) => {
      const body = readFileSync(join(repoRoot, rulePath), "utf-8");
      expect(
        body,
        `${rulePath} must carry the canonical confidence-to-action mapping (D13-2)`,
      ).toContain("Confidence-to-Action Mapping (D13)");
      for (const level of levels) {
        const text = confidenceExplanation(level);
        expect(
          body,
          `${rulePath} is missing the ${level} confidence-to-action string "${text}" — the rule and confidenceExplanation() have drifted (D13-2).`,
        ).toContain(text);
      }
    },
  );

  it("confidenceExplanation returns a distinct non-empty string per level", () => {
    const seen = new Set(levels.map((l) => confidenceExplanation(l)));
    expect(seen.size).toBe(levels.length);
    for (const text of seen) expect(text.length).toBeGreaterThan(0);
  });
});

describe("iterationVerdictToHandoffVerdict (Finding D7-12)", () => {
  it("maps a clean iteration verdict to the CLEAN handoff verdict", () => {
    expect(iterationVerdictToHandoffVerdict("clean")).toBe("CLEAN");
  });

  it("maps warning and critical iteration verdicts to UNRESOLVED (fail-closed)", () => {
    expect(iterationVerdictToHandoffVerdict("warning")).toBe("UNRESOLVED");
    expect(iterationVerdictToHandoffVerdict("critical")).toBe("UNRESOLVED");
  });

  it("only ever returns a handoff-scale value, never an iteration-scale value", () => {
    const handoffValues = new Set(["CLEAN", "UNRESOLVED"]);
    const iterationVerdicts: ReviewIterationVerdict[] = ["clean", "warning", "critical"];
    for (const v of iterationVerdicts) {
      expect(handoffValues.has(iterationVerdictToHandoffVerdict(v))).toBe(true);
    }
  });
});
