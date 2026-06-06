import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  createReviewLoop,
  canContinueReview,
  recordReviewIteration,
  terminateReviewLoop,
  reviewLoopSummary,
  reviewLoopConfidence,
  detectOscillation,
  enforceReviewIteration,
  assertReviewIterationAllowed,
  evaluateReviewGate,
  confidenceExplanation,
  CALIBRATION,
  DEFAULT_MAX_REVIEW_ITERATIONS,
  HARD_MAX_REVIEW_ITERATIONS,
  MIN_MAX_REVIEW_ITERATIONS,
  type ReviewConfidenceLevel,
  type ReviewVerdict,
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
    // "the iteration cap is enforced by the prompt directive" while the six
    // "max 3" command bodies, bug-pipeline's two "max 4" statements,
    // board-fill's two spec-class "4" statements, and the detail rule's two
    // "3" statements went unchecked and could drift freely.
    //
    // CAP_SURFACE_REGISTRY below is the single enumerated source of every
    // file that states the review-loop iteration cap. Each entry declares its
    // loop class; the cap integer is derived from DEFAULT_MAX_REVIEW_ITERATIONS
    // so a future change to the code constant forces every prose surface to be
    // updated in the same change (or the parity test fails):
    //   - "default" / "spec" classes equal DEFAULT_MAX_REVIEW_ITERATIONS (4).
    //     The board-fill spec-class loop matches the default because issue-spec
    //     reviews converge slowly (commands/hatch3r-board-fill.md §7.9d rationale).
    //   - "code" class equals DEFAULT_MAX_REVIEW_ITERATIONS - 1 (3). Code
    //     reviews diverge faster, so the code-class loops cap one below the
    //     default (commands/hatch3r-workflow.md §3a rationale).
    // `occurrences` pins how many times the cap phrase appears per file, so
    // adding or deleting a cap statement (not just changing its integer) also
    // trips the guard — the registry is exhaustive, not best-effort.
    const CODE_CLASS_CAP = DEFAULT_MAX_REVIEW_ITERATIONS - 1;
    const capForClass = (loopClass: "default" | "spec" | "code"): number =>
      loopClass === "code" ? CODE_CLASS_CAP : DEFAULT_MAX_REVIEW_ITERATIONS;

    interface CapSurface {
      /** Repo-root-relative path to the cap-stating file. */
      path: string;
      /** Human label for assertion messages. */
      label: string;
      /** Loop class that fixes the expected integer. */
      loopClass: "default" | "spec" | "code";
      /** Global regex whose first capture group is the stated cap integer. */
      regex: RegExp;
      /** Exact number of times the regex must match in the file. */
      occurrences: number;
    }

    const CAP_SURFACE_REGISTRY: readonly CapSurface[] = [
      // ── default class (== DEFAULT_MAX_REVIEW_ITERATIONS) ──────────────
      {
        path: "rules/hatch3r-agent-orchestration.md",
        label: "orchestration rule (canonical) Phase 3 step 3",
        loopClass: "default",
        regex: /max\s+(\d+)\s+iterations\s+\(matches\s+`DEFAULT_MAX_REVIEW_ITERATIONS`/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration.mdc",
        label: "orchestration rule (Cursor parity) Phase 3 step 3",
        loopClass: "default",
        regex: /max\s+(\d+)\s+iterations\s+\(matches\s+`DEFAULT_MAX_REVIEW_ITERATIONS`/g,
        occurrences: 1,
      },
      {
        path: "agents/hatch3r-reviewer.md",
        label: "reviewer agent Review Loop Termination",
        loopClass: "default",
        regex: /After\s+(\d+)\s+review-fix cycles\s+\(default\s+`DEFAULT_MAX_REVIEW_ITERATIONS=(\d+)`/g,
        occurrences: 1,
      },
      {
        path: "agents/hatch3r-fixer.md",
        label: "fixer agent Review Loop Termination",
        loopClass: "default",
        regex: /After\s+(\d+)\s+review-fix cycles\s+\(default\s+`DEFAULT_MAX_REVIEW_ITERATIONS=(\d+)`/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-bug-pipeline.md",
        label: "bug-pipeline root-cause-depth review loop (table row)",
        loopClass: "default",
        regex: /\(max\s+(\d+)\s+iterations\)\s+\|\s+No \(sequential\)/g,
        occurrences: 1,
      },
      {
        path: "commands/hatch3r-bug-pipeline.md",
        label: "bug-pipeline review-loop body (matching DEFAULT_MAX_REVIEW_ITERATIONS)",
        loopClass: "default",
        regex: /max\s+(\d+)\s+iterations,\s+matching\s+`DEFAULT_MAX_REVIEW_ITERATIONS`/g,
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
      {
        path: "commands/hatch3r-revision.md",
        label: "revision review loop (table row + Stage 1 body)",
        loopClass: "code",
        regex: /max\s+(\d+)\s+iterations/g,
        occurrences: 2,
      },
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
      {
        path: "rules/hatch3r-agent-orchestration-detail.md",
        label: "detail rule PipelineContext reviewResult.iterations comment (canonical)",
        loopClass: "code",
        regex: /1 to code-class cap \(DEFAULT_MAX_REVIEW_ITERATIONS - 1 = (\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.md",
        label: "detail rule failure-mode table (canonical)",
        loopClass: "code",
        regex: /Max iterations \((\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.md",
        label: "detail rule retry-policy (canonical)",
        loopClass: "code",
        regex: /review loop retries up to\s+(\d+)\s+iterations/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.mdc",
        label: "detail rule PipelineContext reviewResult.iterations comment (Cursor parity)",
        loopClass: "code",
        regex: /1 to code-class cap \(DEFAULT_MAX_REVIEW_ITERATIONS - 1 = (\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.mdc",
        label: "detail rule failure-mode table (Cursor parity)",
        loopClass: "code",
        regex: /Max iterations \((\d+)\)/g,
        occurrences: 1,
      },
      {
        path: "rules/hatch3r-agent-orchestration-detail.mdc",
        label: "detail rule retry-policy (Cursor parity)",
        loopClass: "code",
        regex: /review loop retries up to\s+(\d+)\s+iterations/g,
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
    ];

    it("every review-loop cap surface in CAP_SURFACE_REGISTRY matches its loop class (Finding D7-3)", () => {
      // Finding C9-M48 / D15-SA15.2-F15.2-06 / D5-SA5.1-F1 are subsumed here:
      // the rule (.md/.mdc) and reviewer/fixer surfaces remain covered, now as
      // registry entries alongside the previously-uncovered command + detail
      // surfaces. The registry is the enumerated single source — extend it
      // when a new cap-stating surface is authored.
      const repoRoot = process.cwd();
      // Self-check: the registry must enumerate every file that states a cap.
      // 15 distinct files carry cap statements (rule, rule.mdc, reviewer,
      // fixer, bug-pipeline, board-fill, quick-change, revision, board-pickup,
      // workflow, detail.md, detail.mdc, release, debug, pickup-delegation,
      // pickup-delegation-multi). detail.md/.mdc each state the code-class cap
      // three times (Finding D7-2: reviewResult.iterations comment,
      // failure-mode table, retry-policy); release/debug/delegation×2 add one
      // code-class directive each (Finding D7-1) => 22 entries. Guard against a
      // future edit that silently empties the registry.
      expect(
        CAP_SURFACE_REGISTRY.length,
        "CAP_SURFACE_REGISTRY must remain populated — it is the single enumerated source of review-loop cap surfaces",
      ).toBeGreaterThanOrEqual(20);

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
      const repoRoot = process.cwd();
      for (const path of [
        "rules/hatch3r-agent-orchestration-detail.md",
        "rules/hatch3r-agent-orchestration-detail.mdc",
      ]) {
        const body = readFileSync(join(repoRoot, path), "utf-8");
        const symbolicRow =
          /Phase 3 Review Loop \| `hatch3r-reviewer` ↔ `hatch3r-fixer` \(max `DEFAULT_MAX_REVIEW_ITERATIONS`\)/g;
        const matches = [...body.matchAll(symbolicRow)];
        expect(
          matches.length,
          `${path} — the cross-command Pipeline Pattern Phase-3 row must reference DEFAULT_MAX_REVIEW_ITERATIONS symbolically (default-class cap). A bare integer here re-opens the cap-drift gap (Finding D7-2).`,
        ).toBe(1);
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

    it("should report no oscillation for a single direction change", () => {
      let state = createReviewLoop(5);
      // Findings: 5 -> 2 -> 4 (down, up = 1 direction change, threshold is 2)
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 4);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
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
      const verdicts: Array<{ verdict: ReviewVerdict; findings: number }> = [
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
