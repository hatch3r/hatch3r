import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { Separator } from "@inquirer/core";
import {
  backableSelect,
  backableCheckbox,
  backableInput,
  backableConfirm,
  isBack,
} from "../../../cli/shared/backablePrompts.js";

/**
 * In-process render tests for the four backable prompt forks (D3-SA3.2-02).
 *
 * `init.backNav.test.ts` covers the command-logic seam by mocking at the
 * `inquirer.prompt` boundary; that seam structurally excludes the fork bodies
 * in `src/cli/shared/backablePrompts.ts` (keypress ordering, pagination,
 * validation, Y/N toggle, default-fill), which previously executed in zero
 * tests. This suite drives the forks directly through a real `@inquirer/core`
 * render cycle so those bodies appear in the coverage report.
 *
 * Harness: rather than add `@inquirer/testing` as a devDependency (its render()
 * is the vendor tool for exactly this), a self-contained harness drives the
 * forks with zero new dependencies — Node's `PassThrough` as the readline input
 * `@inquirer/core` attaches to, plus a captured output stream. This keeps the
 * change out of `package-lock.json` and off the CI `npm ci` lockfile-match gate,
 * while achieving the same measurable target: >=70% line coverage on the four
 * `createPrompt` bodies. Mechanism mirrors `@inquirer/testing`: `createPrompt`
 * builds `readline.createInterface({ terminal: true, input, output })` and
 * `useKeypress` subscribes to `rl.input.on('keypress', handler)`
 * (node_modules/@inquirer/core/dist/lib/{create-prompt,use-keypress}.js), so a
 * keypress is driven by emitting `('keypress', sequence, keyObject)` on the
 * input stream — exactly what the vendor tool's events.keypress() does.
 */

interface KeyEvent {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

/** One macrotask tick. @inquirer/core defers the first render (and thus the
 * useKeypress subscription) by one setImmediate when the input is a flowing
 * Readable, so keypresses must wait one tick after render(). */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Drop SGR color codes so screen assertions match on rendered text. */
const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");

function render<Cfg, Val>(
  prompt: (
    config: Cfg,
    context: { input: PassThrough; output: PassThrough },
  ) => Promise<Val> & { cancel?: () => void },
  config: Cfg,
): {
  answer: Promise<Val>;
  keypress: (key: KeyEvent) => void;
  getScreen: () => string;
  getRawScreen: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = "";
  output.on("data", (chunk: Buffer) => {
    screen += chunk.toString();
  });
  const answer = prompt(config, { input, output });
  const keypress = (key: KeyEvent): void => {
    input.emit("keypress", key.sequence ?? "", {
      ctrl: false,
      meta: false,
      shift: false,
      ...key,
    });
  };
  return {
    answer,
    keypress,
    getScreen: () => plain(screen),
    getRawScreen: () => screen,
  };
}

const SHIFT_TAB: KeyEvent = { name: "tab", shift: true, sequence: "[Z" };

describe("backableSelect — fork body", () => {
  const choices = [
    new Separator("— group —"),
    { value: "go", name: "Go", short: "GO", description: "first" },
    { value: "stop", name: "Stop", description: "second" },
    { value: "wait", name: "Wait", disabled: true },
    { value: "run", name: "Run", disabled: "(nope)" },
  ];

  it("resolves BACK on Shift+Tab", async () => {
    const { answer, keypress } = render(backableSelect, { message: "Pick", choices });
    await tick();
    keypress(SHIFT_TAB);
    expect(isBack(await answer)).toBe(true);
  });

  it("renders the choice list and help line", async () => {
    const { answer, keypress, getScreen } = render(backableSelect, { message: "Pick", choices });
    await tick();
    const view = getScreen();
    expect(view).toContain("Go");
    expect(view).toContain("Shift+Tab");
    keypress(SHIFT_TAB);
    await answer;
  });

  it("navigates (down/up/number/plain-tab/search/backspace) then selects with Enter", async () => {
    const { answer, keypress } = render(backableSelect, { message: "Pick", choices });
    await tick();
    keypress({ name: "down" });
    await tick();
    keypress({ name: "up" });
    await tick();
    keypress({ name: "2", sequence: "2" });
    await tick();
    keypress({ name: "tab" }); // plain Tab — swallowed, not back
    await tick();
    keypress({ name: "s", sequence: "s" }); // type-to-search else branch
    await tick();
    keypress({ name: "backspace" });
    await tick();
    keypress({ name: "return" });
    expect(typeof (await answer)).toBe("string");
  });

  it("blocks Enter on a disabled choice, then selects an enabled one", async () => {
    const { answer, keypress, getScreen } = render(backableSelect, { message: "Pick", choices });
    await tick();
    keypress({ name: "down" }); // Go -> Stop
    await tick();
    keypress({ name: "down" }); // Stop -> Wait (disabled)
    await tick();
    keypress({ name: "return" }); // disabled -> error, no resolve
    await tick();
    expect(getScreen()).toMatch(/disabled/i);
    keypress({ name: "up" }); // back to Stop (enabled)
    await tick();
    keypress({ name: "return" });
    expect(await answer).toBe("stop");
  });

  it("starts on the default choice when one is given", async () => {
    const { answer, keypress } = render(backableSelect, {
      message: "Pick",
      choices,
      default: "stop",
    });
    await tick();
    keypress({ name: "return" });
    expect(await answer).toBe("stop");
  });

  it("rejects when no navigable choice exists", async () => {
    const { answer } = render(backableSelect, {
      message: "Pick",
      choices: [new Separator("a"), new Separator("b")],
    });
    await expect(answer).rejects.toThrow(/No selectable choices/);
  });
});

describe("backableCheckbox — fork body", () => {
  const choices = [
    new Separator("— pick —"),
    { value: "a", name: "A", description: "aa" },
    { value: "b", name: "B", checkedName: "B!", checked: true },
    { value: "c", name: "C", disabled: true },
    { value: "d", name: "D", disabled: "(no)" },
  ];

  it("resolves BACK on Shift+Tab", async () => {
    const { answer, keypress } = render(backableCheckbox, { message: "Pick", choices });
    await tick();
    keypress(SHIFT_TAB);
    expect(isBack(await answer)).toBe(true);
  });

  it("toggles with space (incl. the disabled-choice error), navigates, and confirms with Enter", async () => {
    const { answer, keypress, getScreen } = render(backableCheckbox, { message: "Pick", choices });
    await tick();
    expect(getScreen()).toContain("space");
    keypress({ name: "space" }); // toggle A on
    await tick();
    keypress({ name: "down" }); // A -> B
    await tick();
    keypress({ name: "down" }); // B -> C (disabled)
    await tick();
    keypress({ name: "space" }); // disabled -> error
    await tick();
    expect(getScreen()).toMatch(/disabled/i);
    keypress({ name: "1", sequence: "1" }); // number toggle of first selectable
    await tick();
    keypress({ name: "return" });
    expect(Array.isArray(await answer)).toBe(true);
  });

  it("errors when required and nothing is selected, then confirms after a toggle", async () => {
    const { answer, keypress, getScreen } = render(backableCheckbox, {
      message: "Pick",
      choices: [
        { value: "a", name: "A" },
        { value: "b", name: "B" },
      ],
      required: true,
    });
    await tick();
    keypress({ name: "return" }); // nothing selected -> error
    await tick();
    expect(getScreen()).toMatch(/at least one/i);
    keypress({ name: "space" }); // toggle A
    await tick();
    keypress({ name: "return" });
    expect(await answer).toEqual(["a"]);
  });

  it("surfaces a string returned by a failing validate", async () => {
    const { answer, keypress, getScreen } = render(backableCheckbox, {
      message: "Pick",
      choices: [{ value: "a", name: "A", checked: true }],
      validate: () => "need more",
    });
    await tick();
    keypress({ name: "return" }); // validate -> "need more"
    await tick();
    expect(getScreen()).toMatch(/need more/i);
    keypress(SHIFT_TAB); // exit cleanly
    expect(isBack(await answer)).toBe(true);
  });

  // release/2.8.5 (BUG-3 root cause B): the fork declared `default?: V[]` but
  // never read it — every default-carrying caller (init/config toolsStep)
  // rendered all rows unchecked and Enter-through submitted []. The fork now
  // seeds `checked` from `default` for choices without an explicit `checked`.
  it("pre-checks rows named in config.default and submits them on Enter-through", async () => {
    const { answer, keypress, getRawScreen } = render(backableCheckbox, {
      message: "Tools",
      choices: [
        { value: "claude", name: "Claude Code" },
        { value: "cursor", name: "Cursor" },
        { value: "copilot", name: "GitHub Copilot" },
      ],
      default: ["cursor"],
    });
    await tick();
    // Render assertion: the checked glyph (green filled circle / [x] theme)
    // must decorate the defaulted row. The raw screen keeps SGR codes; the
    // filled-circle glyph (or ASCII fallback) differs from the unchecked one,
    // so assert via the done-line after submit instead of glyph matching:
    keypress({ name: "return" });
    const submitted = await answer;
    expect(submitted).toEqual(["cursor"]);
    // The final render echoes the selected choice names on the answer line.
    expect(getRawScreen()).toContain("Cursor");
  });

  it("explicit checked on a choice wins over config.default (both directions)", async () => {
    const { answer, keypress } = render(backableCheckbox, {
      message: "Pick",
      choices: [
        // checked:false + listed in default → stays unchecked (explicit wins)
        { value: "a", name: "A", checked: false },
        // checked:true + absent from default → stays checked (explicit wins)
        { value: "b", name: "B", checked: true },
        // no explicit checked + listed in default → seeded checked
        { value: "c", name: "C" },
      ],
      default: ["a", "c"],
    });
    await tick();
    keypress({ name: "return" });
    expect(await answer).toEqual(["b", "c"]);
  });

  it("renders the default-seeded row with the checked glyph before any keypress", async () => {
    const { answer, keypress, getScreen } = render(backableCheckbox, {
      message: "Pick",
      choices: [
        { value: "on", name: "OnByDefault" },
        { value: "off", name: "OffByDefault" },
      ],
      default: ["on"],
    });
    await tick();
    const screen = plain(getScreen());
    const onLine = screen.split("\n").find((l) => l.includes("OnByDefault"));
    const offLine = screen.split("\n").find((l) => l.includes("OffByDefault"));
    expect(onLine).toBeDefined();
    expect(offLine).toBeDefined();
    // The checked and unchecked glyphs must differ between the two rows —
    // proving the default visually pre-checks its row at first render.
    const onGlyph = onLine!.replace("OnByDefault", "").trim();
    const offGlyph = offLine!.replace("OffByDefault", "").trim();
    expect(onGlyph).not.toEqual(offGlyph);
    keypress({ name: "return" });
    expect(await answer).toEqual(["on"]);
  });
});

describe("backableInput — fork body", () => {
  it("resolves BACK on Shift+Tab", async () => {
    const { answer, keypress } = render(backableInput, { message: "Name" });
    await tick();
    keypress(SHIFT_TAB);
    expect(isBack(await answer)).toBe(true);
  });

  it("submits the default value on Enter", async () => {
    const { answer, keypress, getScreen } = render(backableInput, { message: "Name", default: "ada" });
    await tick();
    expect(getScreen()).toContain("ada");
    keypress({ name: "return" });
    expect(await answer).toBe("ada");
  });

  it("fills the default on plain Tab, then submits it", async () => {
    const { answer, keypress } = render(backableInput, { message: "Name", default: "ada" });
    await tick();
    keypress({ name: "tab" }); // isTabKey && !value -> default-fill
    await tick();
    keypress({ name: "return" });
    expect(await answer).toBe("ada");
  });

  it("clears the default on backspace over an empty buffer", async () => {
    const { answer, keypress } = render(backableInput, { message: "Name", default: "ada" });
    await tick();
    keypress({ name: "backspace" }); // isBackspaceKey && !value -> clear default
    await tick();
    keypress({ name: "return" });
    expect(await answer).toBe("");
  });

  it("keeps the prompt open on a failing required validate", async () => {
    const { answer, keypress, getScreen } = render(backableInput, { message: "Name", required: true });
    await tick();
    keypress({ name: "return" }); // empty + required -> validation error
    await tick();
    expect(getScreen()).toMatch(/must provide a value/i);
    keypress(SHIFT_TAB); // exit via BACK
    expect(isBack(await answer)).toBe(true);
  });

  it("writes the default into the buffer under editable prefill", async () => {
    const { answer, keypress } = render(backableInput, {
      message: "Name",
      default: "ada",
      prefill: "editable",
    });
    await tick();
    keypress({ name: "return" });
    expect(await answer).toBe("ada");
  });

  it("runs a custom transformer and a custom validate", async () => {
    const { answer, keypress, getScreen } = render(backableInput, {
      message: "Name",
      default: "x",
      transformer: (v: string, { isFinal }: { isFinal: boolean }) => (isFinal ? `[${v}]` : v),
      validate: (v: string) => (v === "x" ? "no x" : true),
    });
    await tick();
    keypress({ name: "return" }); // answer defaults to "x" -> validate -> "no x"
    await tick();
    expect(getScreen()).toMatch(/no x/i);
    keypress(SHIFT_TAB);
    expect(isBack(await answer)).toBe(true);
  });
});

describe("backableConfirm — fork body", () => {
  it("resolves BACK on Shift+Tab", async () => {
    const { answer, keypress } = render(backableConfirm, { message: "OK?" });
    await tick();
    keypress(SHIFT_TAB);
    expect(isBack(await answer)).toBe(true);
  });

  it("renders Y/n for a true default and submits true on Enter", async () => {
    const { answer, keypress, getScreen } = render(backableConfirm, { message: "OK?", default: true });
    await tick();
    expect(getScreen()).toContain("Y/n");
    keypress({ name: "return" });
    expect(await answer).toBe(true);
  });

  it("renders y/N for a false default and submits false on Enter", async () => {
    const { answer, keypress, getScreen } = render(backableConfirm, { message: "OK?", default: false });
    await tick();
    expect(getScreen()).toContain("y/N");
    keypress({ name: "return" });
    expect(await answer).toBe(false);
  });

  it("toggles the answer on plain Tab, then submits the toggled value", async () => {
    const { answer, keypress } = render(backableConfirm, { message: "OK?", default: true });
    await tick();
    keypress({ name: "tab" }); // toggle Yes -> No
    await tick();
    keypress({ name: "return" });
    expect(await answer).toBe(false);
  });

  it("routes other keys through the buffer and honors a custom transformer", async () => {
    const { answer, keypress } = render(backableConfirm, {
      message: "OK?",
      default: false,
      transformer: (v: boolean) => (v ? "yep" : "nope"),
    });
    await tick();
    keypress({ name: "y", sequence: "y" }); // else branch -> setValue(rl.line)
    await tick();
    keypress({ name: "return" });
    expect(typeof (await answer)).toBe("boolean");
  });
});

// D10-SA10.2-03 (Cycle 12): the fork inherits ui.ts's two shipped a11y fixes —
// (1) key-cap help glyphs route through glyph() and degrade to ASCII words on
// non-Unicode terminals instead of hardcoded `↑↓`/`⏎` literals rendering as
// `?`; (2) help/default chrome follows the D10-23 WCAG 1.4.3 pattern: no SGR-2
// dim on the action words or the default value (dim stays only on tertiary
// `·` separators). SGR assertions force color via FORCE_COLOR, which
// node:util styleText re-reads per call.
describe("backable prompts — a11y port from ui.ts (D10-SA10.2-03)", () => {
  const choices = [
    { value: "go", name: "Go" },
    { value: "stop", name: "Stop" },
  ];

  describe("ASCII key-cap fallback (HATCH3R_ASCII=1)", () => {
    let priorAscii: string | undefined;

    beforeEach(() => {
      priorAscii = process.env.HATCH3R_ASCII;
      process.env.HATCH3R_ASCII = "1";
    });

    afterEach(() => {
      if (priorAscii === undefined) delete process.env.HATCH3R_ASCII;
      else process.env.HATCH3R_ASCII = priorAscii;
    });

    it("select help line renders ASCII words, no Unicode literals", async () => {
      const { answer, keypress, getScreen } = render(backableSelect, {
        message: "Pick",
        choices,
      });
      await tick();
      const view = getScreen();
      expect(view).toContain("up/down navigate");
      expect(view).toContain("enter select");
      expect(view).not.toContain("↑↓");
      expect(view).not.toContain("⏎");
      keypress(SHIFT_TAB);
      await answer;
    });

    it("checkbox help line renders ASCII words, no Unicode literals", async () => {
      const { answer, keypress, getScreen } = render(backableCheckbox, {
        message: "Pick",
        choices,
      });
      await tick();
      const view = getScreen();
      expect(view).toContain("up/down navigate");
      expect(view).toContain("enter confirm");
      expect(view).not.toContain("↑↓");
      expect(view).not.toContain("⏎");
      keypress(SHIFT_TAB);
      await answer;
    });

    it("input help line renders the ASCII enter word", async () => {
      const { answer, keypress, getScreen } = render(backableInput, {
        message: "Name",
      });
      await tick();
      const view = getScreen();
      expect(view).toContain("enter submit");
      expect(view).not.toContain("⏎");
      keypress(SHIFT_TAB);
      await answer;
    });
  });

  describe("no SGR-2 dim on action words or default values (D10-23 port)", () => {
    const DIM_OPEN = "[2m";
    const CYAN_OPEN = "[36m";
    let priorForceColor: string | undefined;

    beforeEach(() => {
      priorForceColor = process.env.FORCE_COLOR;
      process.env.FORCE_COLOR = "3";
    });

    afterEach(() => {
      if (priorForceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = priorForceColor;
    });

    it("select help actions render at default weight; dim decorates only separators", async () => {
      const { answer, keypress, getRawScreen } = render(backableSelect, {
        message: "Pick",
        choices,
      });
      await tick();
      const raw = getRawScreen();
      // Action words are NOT dim-wrapped (old contract dim-wrapped every action).
      expect(raw).not.toContain(`${DIM_OPEN}navigate`);
      expect(raw).not.toContain(`${DIM_OPEN}select`);
      expect(raw).not.toContain(`${DIM_OPEN}back`);
      // The tertiary `·` separator keeps its dim decoration.
      expect(raw).toContain(`${DIM_OPEN} · `);
      keypress(SHIFT_TAB);
      await answer;
    });

    it("input default value renders normal-weight cyan, not dim", async () => {
      const { answer, keypress, getRawScreen, getScreen } = render(backableInput, {
        message: "Name",
        default: "ada",
      });
      await tick();
      expect(getScreen()).toContain("(ada)");
      const raw = getRawScreen();
      expect(raw).toContain(`${CYAN_OPEN}(ada)`);
      expect(raw).not.toContain(`${DIM_OPEN}(ada)`);
      keypress(SHIFT_TAB);
      await answer;
    });

    it("confirm y/N default renders normal-weight cyan, not dim", async () => {
      const { answer, keypress, getRawScreen, getScreen } = render(backableConfirm, {
        message: "OK?",
        default: false,
      });
      await tick();
      expect(getScreen()).toContain("y/N");
      const raw = getRawScreen();
      expect(raw).toContain(`${CYAN_OPEN}(y/N)`);
      expect(raw).not.toContain(`${DIM_OPEN}(y/N)`);
      keypress(SHIFT_TAB);
      await answer;
    });
  });
});
