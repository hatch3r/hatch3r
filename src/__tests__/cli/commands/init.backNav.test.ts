import { describe, it, expect, vi, beforeEach } from "vitest";
import inquirer from "inquirer";
import {
  BACK,
  askCheckbox,
  askConfirm,
  askInput,
  askSelect,
  isBack,
  runStepMachine,
  type Step,
} from "../../../cli/shared/initSteps.js";
import { __testing as backableTesting } from "../../../cli/shared/backablePrompts.js";

// Mirror init.test.ts: mock inquirer.prompt so each helper call returns a
// queued answer shape. The Shift+Tab refactor (commit message: ↑↓ navigate
// · ⏎ select · Shift+Tab back) replaced the inline "← Back" menu choice
// and `:back` string trigger with a keypress signalled by the backable
// prompts in `src/cli/shared/backablePrompts.ts`. Tests mock at the
// inquirer.prompt boundary, so they queue the BACK sentinel directly to
// simulate a Shift+Tab keypress; Symbol.for("hatch3r.BACK") guarantees
// identity holds across the mocked/production module boundary.
vi.mock("inquirer", () => {
  class Separator {
    constructor(public readonly line: string) {}
  }
  return {
    default: {
      prompt: vi.fn(),
      Separator,
    },
  };
});

beforeEach(() => {
  vi.mocked(inquirer.prompt).mockReset();
});

describe("runStepMachine — linear advance", () => {
  it("returns the final state after three forward steps", async () => {
    interface S { a: string; b: number; c: boolean }
    const steps: Array<Step<S>> = [
      { id: "a", async run() { return "alpha"; } },
      { id: "b", async run() { return 42; } },
      { id: "c", async run() { return true; } },
    ];
    const result = await runStepMachine<S>(steps);
    expect(result).toEqual({ a: "alpha", b: 42, c: true });
  });
});

describe("runStepMachine — BACK from step 1", () => {
  it("re-prompts the same step (first-step BACK is a no-op)", async () => {
    interface S { a: string }
    let calls = 0;
    const steps: Array<Step<S>> = [
      {
        id: "a",
        async run() {
          calls++;
          if (calls === 1) return BACK;
          return "after-back";
        },
      },
    ];
    const result = await runStepMachine<S>(steps);
    expect(calls).toBe(2);
    expect(result.a).toBe("after-back");
  });
});

describe("runStepMachine — BACK from step 2", () => {
  it("walks back to step 0; step 1 re-render receives prior answer as default", async () => {
    interface S { a: string; b: string }
    const aCalls: Array<string | undefined> = [];
    const bCalls: Array<string | undefined> = [];
    let bVisits = 0;
    const steps: Array<Step<S>> = [
      {
        id: "a",
        async run(_state, previous) {
          aCalls.push(previous);
          return "A1";
        },
      },
      {
        id: "b",
        async run(_state, previous) {
          bCalls.push(previous);
          bVisits++;
          if (bVisits === 1) return BACK;
          return "B-final";
        },
      },
    ];
    const result = await runStepMachine<S>(steps);
    expect(result).toEqual({ a: "A1", b: "B-final" });
    // Step a should have re-prompted with its prior answer as `previous`.
    expect(aCalls).toEqual([undefined, "A1"]);
    // Step b's first-visit prior is undefined; walk-back does not write
    // prev[b] because b returned BACK, so the second visit also gets
    // undefined.
    expect(bCalls).toEqual([undefined, undefined]);
  });
});

describe("runStepMachine — skip cascade", () => {
  it("walks back past skipped steps", async () => {
    interface S { a: string; b: string; c: string; d: string }
    let dVisits = 0;
    const stepBSkipped = vi.fn().mockReturnValue(true);
    const steps: Array<Step<S>> = [
      { id: "a", async run() { return "A"; } },
      { id: "b", async run() { return "B"; } },
      { id: "c", skip: stepBSkipped, async run() { throw new Error("c should be skipped"); } },
      {
        id: "d",
        async run() {
          dVisits++;
          if (dVisits === 1) return BACK;
          return "D";
        },
      },
    ];
    const result = await runStepMachine<S>(steps);
    expect(result.a).toBe("A");
    expect(result.b).toBe("B");
    expect(result.d).toBe("D");
    expect(stepBSkipped).toHaveBeenCalled();
  });
});

describe("runStepMachine — MCP gate flip", () => {
  it("skipped step's prior answer is cleared from final state", async () => {
    interface S { wantMcp: boolean; mcpServers: string[] }
    let gateVisits = 0;
    let serversVisits = 0;
    const steps: Array<Step<S>> = [
      {
        id: "wantMcp",
        async run() {
          gateVisits++;
          if (gateVisits === 1) return true;
          return false;
        },
      },
      {
        id: "mcpServers",
        skip: (s) => !s.wantMcp,
        async run() {
          serversVisits++;
          if (serversVisits === 1) return BACK;
          return ["should-not-happen"];
        },
      },
    ];
    const result = await runStepMachine<S>(steps);
    expect(result.wantMcp).toBe(false);
    expect(result.mcpServers).toBeUndefined();
    expect(serversVisits).toBe(1);
    expect(gateVisits).toBe(2);
  });
});

describe("askSelect / askCheckbox / askInput / askConfirm — BACK sentinel", () => {
  it("askSelect returns BACK when the prompt resolves with the sentinel", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: BACK });
    const r = await askSelect({
      name: "x",
      message: "Pick one",
      choices: [{ name: "Go", value: "go" }],
    });
    expect(isBack(r)).toBe(true);
  });

  it("askSelect returns the chosen value otherwise", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: "go" });
    const r = await askSelect({
      name: "x",
      message: "Pick one",
      choices: [{ name: "Go", value: "go" }],
    });
    expect(r).toBe("go");
  });

  it("askCheckbox returns BACK when the prompt resolves with the sentinel", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: BACK });
    const r = await askCheckbox({
      name: "x",
      message: "Pick many",
      choices: [
        { name: "A", value: "a" },
        { name: "B", value: "b" },
      ],
    });
    expect(isBack(r)).toBe(true);
  });

  it("askCheckbox forwards the array of selected values otherwise", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: ["a", "b"] });
    const r = await askCheckbox({
      name: "x",
      message: "Pick many",
      choices: [
        { name: "A", value: "a" },
        { name: "B", value: "b" },
      ],
    });
    expect(r).toEqual(["a", "b"]);
  });

  it("askInput returns BACK when the prompt resolves with the sentinel", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: BACK });
    const r = await askInput({ name: "x", message: "Q" });
    expect(isBack(r)).toBe(true);
  });

  it("askInput forwards the typed string otherwise", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: "anything" });
    const r = await askInput({ name: "x", message: "Q" });
    expect(r).toBe("anything");
  });

  it("askConfirm returns BACK when the prompt resolves with the sentinel", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: BACK });
    const r = await askConfirm({ name: "x", message: "Yes/No?" });
    expect(isBack(r)).toBe(true);
  });

  it("askConfirm forwards the boolean answer otherwise", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: true });
    const r = await askConfirm({ name: "x", message: "Yes/No?" });
    expect(r).toBe(true);
  });
});

describe("Shift+Tab keypress predicate", () => {
  const { isShiftTabKey } = backableTesting;

  it("matches Shift+Tab", () => {
    expect(isShiftTabKey({ name: "tab", shift: true, ctrl: false })).toBe(true);
  });

  it("does not match plain Tab", () => {
    expect(isShiftTabKey({ name: "tab", shift: false, ctrl: false })).toBe(false);
  });

  it("does not match Ctrl+Shift+Tab", () => {
    expect(isShiftTabKey({ name: "tab", shift: true, ctrl: true })).toBe(false);
  });

  it("does not match Meta+Shift+Tab", () => {
    // KeypressEvent doesn't declare `meta` but Node's readline may set it.
    expect(
      isShiftTabKey({ name: "tab", shift: true, ctrl: false, meta: true } as never),
    ).toBe(false);
  });

  it("does not match Shift+other-key", () => {
    expect(isShiftTabKey({ name: "enter", shift: true, ctrl: false })).toBe(false);
  });
});

describe("Symbol.for identity across modules", () => {
  it("BACK from initSteps equals Symbol.for('hatch3r.BACK')", () => {
    expect(BACK).toBe(Symbol.for("hatch3r.BACK"));
  });
});
