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

// Mirror init.test.ts: mock inquirer.prompt so each helper call returns
// a queued answer shape. Slice E focuses on the step-machine driver in
// isolation — the helpers translate the BACK sentinel and `:back` text
// trigger into machine-level walk-back.
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
    // Step b's second visit should also receive its prior answer as `previous`.
    // First visit: prior is undefined (never answered). Walk-back sets
    // prev[b] only if b returned a real value; because b returned BACK,
    // prev[b] stays undefined — so the second visit also gets undefined.
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
      // c (third in list) is skipped:
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
    // c was skipped both forward and during walk-back — never visited.
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
          // First visit: opt-in. Second visit (after BACK from servers
          // step is not possible because confirm has no BACK; we
          // simulate the gate-flip differently — see test logic).
          if (gateVisits === 1) return true;
          return false;
        },
      },
      {
        id: "mcpServers",
        skip: (s) => !s.wantMcp,
        async run() {
          serversVisits++;
          if (serversVisits === 1) {
            // After picking servers, the user clicks back to the gate.
            return BACK;
          }
          // After the gate flips off, this step should be skipped — so
          // serversVisits should never reach 2.
          return ["should-not-happen"];
        },
      },
    ];
    const result = await runStepMachine<S>(steps);
    expect(result.wantMcp).toBe(false);
    // mcpServers slot was deleted on the second forward pass because
    // skip() became true. Final state has no mcpServers entry.
    expect(result.mcpServers).toBeUndefined();
    expect(serversVisits).toBe(1);
    expect(gateVisits).toBe(2);
  });
});

describe("askInput — `:back` text trigger", () => {
  it("returns BACK for exactly ':back'", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: ":back" });
    const r = await askInput({ name: "x", message: "Q" });
    expect(isBack(r)).toBe(true);
  });

  it("returns BACK for ':back' with trailing whitespace", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: ":back  " });
    const r = await askInput({ name: "x", message: "Q" });
    expect(isBack(r)).toBe(true);
  });

  it("returns the raw string for 'not :back'", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: "not :back" });
    const r = await askInput({ name: "x", message: "Q" });
    expect(r).toBe("not :back");
  });

  it("`:back` short-circuits validator (validator never rejects back-nav)", async () => {
    const validate = vi.fn().mockReturnValue("invalid");
    // The wrapper passes its own validator to inquirer; inquirer would
    // call that wrapper validator with the input before resolving. We
    // simulate the wrapper directly by invoking the call's validate
    // function ourselves.
    let capturedValidate: ((s: string) => boolean | string) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(inquirer.prompt) as any).mockImplementationOnce(async (q: unknown) => {
      const arr = q as Array<{ validate?: (s: string) => boolean | string }>;
      capturedValidate = arr[0]?.validate;
      return { x: ":back" };
    });
    const r = await askInput({ name: "x", message: "Q", validate });
    expect(isBack(r)).toBe(true);
    // Caller's validate should NOT have been called for the ':back' input.
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!(":back")).toBe(true);
    // For a non-:back input, caller's validate IS consulted.
    expect(capturedValidate!("anything-else")).toBe("invalid");
    expect(validate).toHaveBeenCalledWith("anything-else");
  });
});

describe("askSelect / askCheckbox — BACK option prepended", () => {
  it("askSelect prepends '← Back' as the first choice", async () => {
    let captured: Array<{ name: string; value: unknown }> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(inquirer.prompt) as any).mockImplementationOnce(async (q: unknown) => {
      const arr = q as Array<{ choices: Array<{ name: string; value: unknown }> }>;
      captured = arr[0].choices;
      return { x: "go" };
    });
    await askSelect({
      name: "x",
      message: "Pick one",
      choices: [{ name: "Go", value: "go" }],
    });
    expect(captured?.[0]?.name).toBe("← Back");
    expect(captured?.[0]?.value).toBe(BACK);
  });

  it("askSelect returns BACK when the user picks the back sentinel", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: BACK });
    const r = await askSelect({
      name: "x",
      message: "Pick one",
      choices: [{ name: "Go", value: "go" }],
    });
    expect(isBack(r)).toBe(true);
  });

  it("askCheckbox returns BACK when the BACK sentinel is in the answer array", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: ["a", BACK, "b"] });
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

  it("askCheckbox strips BACK from the result when not selected", async () => {
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

  it("askConfirm has no BACK affordance and forwards the boolean answer", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ x: true });
    const r = await askConfirm({ name: "x", message: "Yes/No?" });
    expect(r).toBe(true);
  });
});
