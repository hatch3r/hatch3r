/**
 * Back-navigation prompts for the hatch3r interactive flows.
 *
 * Forks the four built-in inquirer prompts (select / checkbox / input /
 * confirm) via `@inquirer/core`'s `createPrompt`, registered under the same
 * names with `inquirer.registerPrompt`. The forks add one behavior on top
 * of the upstream prompt: pressing **Shift+Tab** resolves the prompt with
 * the {@link BACK} sentinel so the step-machine in
 * `src/cli/shared/initSteps.ts` can walk the user back one step.
 *
 * Why Shift+Tab and not ESC: ESC is indistinguishable from the start byte
 * of any CSI escape sequence at the byte level, so Node's readline
 * disambiguates with a ~50ms timer that mis-fires on laggy SSH. Shift+Tab
 * arrives as CSI Z — a single parsed keypress event with `name: 'tab'` and
 * `shift: true`, no timer race. It also doesn't conflict with text-cursor
 * editing inside input prompts (left/right arrow still move the cursor)
 * or with any readline shortcut.
 *
 * `isTabKey()` from `@inquirer/core` matches BOTH plain Tab and Shift+Tab
 * (it only checks `key.name`). The forks short-circuit on Shift+Tab at the
 * very top of useKeypress so the upstream Tab branches (input default-fill,
 * confirm Y/N toggle) never see the shifted variant.
 */

import inquirer from "inquirer";
import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  usePagination,
  useRef,
  useMemo,
  useEffect,
  isBackspaceKey,
  isEnterKey,
  isTabKey,
  isUpKey,
  isDownKey,
  isSpaceKey,
  isNumberKey,
  makeTheme,
  ValidationError,
  Separator,
  type KeypressEvent,
} from "@inquirer/core";
import { styleText } from "node:util";
import figures from "@inquirer/figures";

/** Sentinel returned when the user presses Shift+Tab in a backable prompt. */
export const BACK: symbol = Symbol.for("hatch3r.BACK");
export type Back = symbol;

export function isBack(value: unknown): value is Back {
  return value === BACK;
}

/**
 * Discriminate Shift+Tab from plain Tab. Node's readline parses CSI Z to
 * `{ name: 'tab', shift: true }`; we require shift AND reject ctrl/meta
 * so Ctrl+Shift+Tab (a terminal-tab shortcut on many emulators) does not
 * trigger back-nav.
 */
function isShiftTabKey(key: KeypressEvent): boolean {
  const hasMeta = (key as KeypressEvent & { meta?: boolean }).meta === true;
  return key.name === "tab" && key.shift === true && !key.ctrl && !hasMeta;
}

// ── select ────────────────────────────────────────────────────────────

interface BackableSelectChoice<V> {
  value: V;
  name?: string;
  short?: string;
  description?: string;
  disabled?: boolean | string;
}

type SelectChoiceItem<V> =
  | BackableSelectChoice<V>
  | InstanceType<typeof Separator>;

interface BackableSelectConfig<V> {
  message: string;
  choices: ReadonlyArray<SelectChoiceItem<V>>;
  default?: V;
  pageSize?: number;
  loop?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  theme?: any;
}

function isSelectSelectable<V>(item: SelectChoiceItem<V>): item is BackableSelectChoice<V> {
  return !Separator.isSeparator(item) && !(item as BackableSelectChoice<V>).disabled;
}

function isSelectNavigable<V>(item: SelectChoiceItem<V>): item is BackableSelectChoice<V> {
  return !Separator.isSeparator(item);
}

const selectTheme = {
  icon: { cursor: figures.pointer },
  style: {
    disabled: (text: string) => styleText("dim", text),
    description: (text: string) => styleText("cyan", text),
    keysHelpTip: (keys: ReadonlyArray<readonly [string, string]>) =>
      keys
        .map(([key, action]) => `${styleText("bold", key)} ${styleText("dim", action)}`)
        .join(styleText("dim", " · ")),
  },
  i18n: { disabledError: "This option is disabled and cannot be selected." },
  indexMode: "hidden",
  keybindings: [] as ReadonlyArray<"emacs" | "vim">,
};

export const backableSelect = createPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <V,>(config: BackableSelectConfig<V>, done: (value: V | Back) => void): any => {
    const { loop = true, pageSize = 7 } = config;
    // makeTheme accepts deep-partial themes at runtime; the strict typed
    // shape rejects our partial overrides, so cast the inputs through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theme: any = makeTheme(selectTheme as any, config.theme as any);
    const [status, setStatus] = useState<"idle" | "done">("idle");
    const prefix = usePrefix({ status, theme });
    const items = useMemo(
      () => config.choices as ReadonlyArray<SelectChoiceItem<V>>,
      [config.choices],
    );
    const bounds = useMemo(() => {
      const first = items.findIndex(isSelectNavigable);
      let last = -1;
      for (let idx = items.length - 1; idx >= 0; idx--) {
        if (isSelectNavigable(items[idx])) { last = idx; break; }
      }
      if (first === -1) {
        throw new ValidationError(
          "[backable-select] No selectable choices — all are disabled.",
        );
      }
      return { first, last };
    }, [items]);
    const defaultItemIndex = useMemo(() => {
      if (!("default" in config)) return -1;
      return items.findIndex(
        (item) => isSelectSelectable(item) && item.value === config.default,
      );
    }, [config.default, items]);
    const [active, setActive] = useState(
      defaultItemIndex === -1 ? bounds.first : defaultItemIndex,
    );
    const selectedChoice = items[active];
    if (selectedChoice == null || Separator.isSeparator(selectedChoice)) {
      // Internal invariant: bounds.first guarantees a navigable choice exists.
      // Hitting this is a programmer error, not user-recoverable — plain Error
      // is correct (HatchError is for CLI-surfaced failures, not invariant breaks
      // inside an inquirer render loop where it would not propagate cleanly).
      // eslint-disable-next-line hatch-error/use-hatch-error
      throw new Error("Active index does not point to a choice");
    }
    const [errorMsg, setError] = useState<string | undefined>(undefined);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useKeypress((key, rl) => {
      // Shift+Tab → back. Check FIRST so the upstream isTabKey()-based
      // branches (which also fire for shifted Tab) never run.
      if (isShiftTabKey(key)) {
        rl.clearLine(0);
        setStatus("done");
        done(BACK);
        return;
      }
      clearTimeout(searchTimeoutRef.current);
      if (errorMsg) setError(undefined);

      if (isEnterKey(key)) {
        if (selectedChoice.disabled) {
          setError(theme.i18n.disabledError);
        } else {
          setStatus("done");
          done(selectedChoice.value);
        }
      } else if (isUpKey(key) || isDownKey(key)) {
        rl.clearLine(0);
        if (
          loop ||
          (isUpKey(key) && active !== bounds.first) ||
          (isDownKey(key) && active !== bounds.last)
        ) {
          const offset = isUpKey(key) ? -1 : 1;
          let next = active;
          do {
            next = (next + offset + items.length) % items.length;
          } while (!isSelectNavigable(items[next]));
          setActive(next);
        }
      } else if (isNumberKey(key) && !Number.isNaN(Number(rl.line))) {
        const selectedIndex = Number(rl.line) - 1;
        let selectableIndex = -1;
        const position = items.findIndex((item) => {
          if (Separator.isSeparator(item)) return false;
          selectableIndex++;
          return selectableIndex === selectedIndex;
        });
        const item = items[position];
        if (item != null && isSelectSelectable(item)) {
          setActive(position);
        }
        searchTimeoutRef.current = setTimeout(() => {
          rl.clearLine(0);
        }, 700);
      } else if (isBackspaceKey(key)) {
        rl.clearLine(0);
      } else if (isTabKey(key)) {
        // Plain Tab (without shift) — swallow so it doesn't bleed into the
        // search buffer below as a literal `\t`. No semantic action.
        rl.clearLine(0);
      } else {
        // Type-to-search.
        const searchTerm = rl.line.toLowerCase();
        const matchIndex = items.findIndex((item) => {
          if (Separator.isSeparator(item) || !isSelectSelectable(item)) return false;
          return (item.name ?? String(item.value)).toLowerCase().startsWith(searchTerm);
        });
        if (matchIndex !== -1) {
          setActive(matchIndex);
        }
        searchTimeoutRef.current = setTimeout(() => {
          rl.clearLine(0);
        }, 700);
      }
    });

    useEffect(() => () => clearTimeout(searchTimeoutRef.current), []);

    const message = theme.style.message(config.message, status);
    const helpLine = theme.style.keysHelpTip([
      ["↑↓", "navigate"],
      ["⏎", "select"],
      ["Shift+Tab", "back"],
    ]);
    let separatorCount = 0;
    const page = usePagination<SelectChoiceItem<V>>({
      items: items as SelectChoiceItem<V>[],
      active,
      renderItem({ item, isActive, index }) {
        if (Separator.isSeparator(item)) {
          separatorCount++;
          return ` ${item.separator}`;
        }
        const cursor = isActive ? theme.icon.cursor : " ";
        const indexLabel =
          theme.indexMode === "number" ? `${index + 1 - separatorCount}. ` : "";
        if (item.disabled) {
          const disabledLabel =
            typeof item.disabled === "string" ? item.disabled : "(disabled)";
          const disabledCursor = isActive ? theme.icon.cursor : "-";
          return theme.style.disabled(
            `${disabledCursor} ${indexLabel}${item.name ?? String(item.value)} ${disabledLabel}`,
          );
        }
        const color = isActive ? theme.style.highlight : (x: string) => x;
        return color(`${cursor} ${indexLabel}${item.name ?? String(item.value)}`);
      },
      pageSize,
      loop,
    });

    if (status === "done") {
      if (isBack(selectedChoice.value)) {
        // Render nothing on the answer line — the step-machine will
        // re-prompt the previous step on the next loop turn.
        return "";
      }
      const short =
        (selectedChoice as BackableSelectChoice<V>).short ??
        (selectedChoice as BackableSelectChoice<V>).name ??
        String(selectedChoice.value);
      return [prefix, message, theme.style.answer(short)].filter(Boolean).join(" ");
    }

    const { description } = selectedChoice as BackableSelectChoice<V>;
    const lines = [
      [prefix, message].filter(Boolean).join(" "),
      page,
      " ",
      description ? theme.style.description(description) : "",
      errorMsg ? theme.style.error(errorMsg) : "",
      helpLine,
    ]
      .filter(Boolean)
      .join("\n")
      .trimEnd();
    return lines;
  },
);

// ── checkbox ──────────────────────────────────────────────────────────

interface BackableCheckboxChoice<V> {
  value: V;
  name?: string;
  short?: string;
  description?: string;
  disabled?: boolean | string;
  checked?: boolean;
  checkedName?: string;
}

type CheckboxChoiceItem<V> =
  | BackableCheckboxChoice<V>
  | InstanceType<typeof Separator>;

interface BackableCheckboxConfig<V> {
  message: string;
  choices: ReadonlyArray<CheckboxChoiceItem<V>>;
  default?: V[];
  pageSize?: number;
  loop?: boolean;
  required?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  theme?: any;
  validate?: (values: V[]) => boolean | string | Promise<boolean | string>;
}

const checkboxTheme = {
  icon: {
    checked: styleText("green", figures.circleFilled),
    unchecked: figures.circle,
    cursor: figures.pointer,
    disabledChecked: styleText("green", figures.circleDouble),
    disabledUnchecked: "-",
  },
  style: {
    disabled: (text: string) => styleText("dim", text),
    description: (text: string) => styleText("cyan", text),
    renderSelectedChoices: <V,>(
      selected: ReadonlyArray<BackableCheckboxChoice<V>>,
    ): string => selected.map((c) => c.short ?? c.name ?? String(c.value)).join(", "),
    keysHelpTip: (keys: ReadonlyArray<readonly [string, string]>) =>
      keys
        .map(([k, a]) => `${styleText("bold", k)} ${styleText("dim", a)}`)
        .join(styleText("dim", " · ")),
  },
  i18n: { disabledError: "This option is disabled and cannot be toggled." },
  keybindings: [] as ReadonlyArray<"emacs" | "vim">,
};

function isCheckboxSelectable<V>(item: CheckboxChoiceItem<V>): item is BackableCheckboxChoice<V> {
  return !Separator.isSeparator(item) && !(item as BackableCheckboxChoice<V>).disabled;
}

function isCheckboxNavigable<V>(item: CheckboxChoiceItem<V>): item is BackableCheckboxChoice<V> {
  return !Separator.isSeparator(item);
}

function isCheckboxChecked<V>(item: CheckboxChoiceItem<V>): item is BackableCheckboxChoice<V> & { checked: true } {
  return !Separator.isSeparator(item) && (item as BackableCheckboxChoice<V>).checked === true;
}

function toggleChoice<V>(item: CheckboxChoiceItem<V>): CheckboxChoiceItem<V> {
  return isCheckboxSelectable(item) ? { ...item, checked: !item.checked } : item;
}

export const backableCheckbox = createPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <V,>(config: BackableCheckboxConfig<V>, done: (value: V[] | Back) => void): any => {
    const { pageSize = 7, loop = true, required, validate = () => true } = config;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theme: any = makeTheme(checkboxTheme as any, config.theme as any);
    const [status, setStatus] = useState<"idle" | "done">("idle");
    const prefix = usePrefix({ status, theme });
    const [items, setItems] = useState<CheckboxChoiceItem<V>[]>(
      [...config.choices] as CheckboxChoiceItem<V>[],
    );
    const bounds = useMemo(() => {
      const first = items.findIndex(isCheckboxNavigable);
      let last = -1;
      for (let idx = items.length - 1; idx >= 0; idx--) {
        if (isCheckboxNavigable(items[idx])) { last = idx; break; }
      }
      if (first === -1) {
        throw new ValidationError(
          "[backable-checkbox] No selectable choices — all are disabled.",
        );
      }
      return { first, last };
    }, [items]);
    const [active, setActive] = useState(bounds.first);
    const [errorMsg, setError] = useState<string | undefined>(undefined);

    useKeypress(async (key) => {
      if (isShiftTabKey(key)) {
        setStatus("done");
        done(BACK);
        return;
      }
      if (isEnterKey(key)) {
        const selection = items.filter(isCheckboxChecked) as BackableCheckboxChoice<V>[];
        const values = selection.map((c) => c.value);
        const isValid = await validate(values);
        if (required && !selection.length) {
          setError("At least one choice must be selected");
        } else if (isValid === true) {
          setStatus("done");
          done(values);
        } else {
          setError(typeof isValid === "string" ? isValid : "You must select a valid value");
        }
      } else if (isUpKey(key) || isDownKey(key)) {
        if (errorMsg) setError(undefined);
        if (
          loop ||
          (isUpKey(key) && active !== bounds.first) ||
          (isDownKey(key) && active !== bounds.last)
        ) {
          const offset = isUpKey(key) ? -1 : 1;
          let next = active;
          do {
            next = (next + offset + items.length) % items.length;
          } while (!isCheckboxNavigable(items[next]));
          setActive(next);
        }
      } else if (isSpaceKey(key)) {
        const activeItem = items[active];
        if (activeItem && !Separator.isSeparator(activeItem)) {
          if ((activeItem as BackableCheckboxChoice<V>).disabled) {
            setError(theme.i18n.disabledError);
          } else {
            setError(undefined);
            setItems(items.map((c, i) => (i === active ? toggleChoice(c) : c)));
          }
        }
      } else if (isNumberKey(key)) {
        const selectedIndex = Number(key.name) - 1;
        let selectableIndex = -1;
        const position = items.findIndex((item) => {
          if (Separator.isSeparator(item)) return false;
          selectableIndex++;
          return selectableIndex === selectedIndex;
        });
        const selectedItem = items[position];
        if (selectedItem && isCheckboxSelectable(selectedItem)) {
          setActive(position);
          setItems(items.map((c, i) => (i === position ? toggleChoice(c) : c)));
        }
      }
    });

    const message = theme.style.message(config.message, status);
    let description: string | undefined;
    const page = usePagination<CheckboxChoiceItem<V>>({
      items,
      active,
      renderItem({ item, isActive }) {
        if (Separator.isSeparator(item)) {
          return ` ${item.separator}`;
        }
        const choice = item as BackableCheckboxChoice<V>;
        const cursor = isActive ? theme.icon.cursor : " ";
        if (choice.disabled) {
          const disabledLabel =
            typeof choice.disabled === "string" ? choice.disabled : "(disabled)";
          const box = choice.checked ? theme.icon.disabledChecked : theme.icon.disabledUnchecked;
          return theme.style.disabled(
            `${cursor}${box} ${choice.name ?? String(choice.value)} ${disabledLabel}`,
          );
        }
        if (isActive) description = choice.description;
        const box = choice.checked ? theme.icon.checked : theme.icon.unchecked;
        const name = choice.checked
          ? (choice.checkedName ?? choice.name ?? String(choice.value))
          : (choice.name ?? String(choice.value));
        const color = isActive ? theme.style.highlight : (x: string) => x;
        return color(`${cursor}${box} ${name}`);
      },
      pageSize,
      loop,
    });

    if (status === "done") {
      const selection = items.filter(isCheckboxChecked) as BackableCheckboxChoice<V>[];
      const answer = theme.style.answer(theme.style.renderSelectedChoices(selection));
      return [prefix, message, answer].filter(Boolean).join(" ");
    }
    const helpLine = theme.style.keysHelpTip([
      ["↑↓", "navigate"],
      ["space", "toggle"],
      ["⏎", "confirm"],
      ["Shift+Tab", "back"],
    ]);
    const lines = [
      [prefix, message].filter(Boolean).join(" "),
      page,
      " ",
      description ? theme.style.description(description) : "",
      errorMsg ? theme.style.error(errorMsg) : "",
      helpLine,
    ]
      .filter(Boolean)
      .join("\n")
      .trimEnd();
    return lines;
  },
);

// ── input ─────────────────────────────────────────────────────────────

interface BackableInputConfig {
  message: string;
  default?: string;
  required?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  theme?: any;
  validate?: (s: string) => boolean | string | Promise<boolean | string>;
  prefill?: "tab" | "editable";
  transformer?: (value: string, opts: { isFinal: boolean }) => string;
}

const inputTheme = { validationFailureMode: "keep" };

export const backableInput = createPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config: BackableInputConfig, done: (value: string | Back) => void): any => {
    const { prefill = "tab" } = config;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theme: any = makeTheme(inputTheme as any, config.theme as any);
    const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
    const [defaultValue, setDefaultValue] = useState(String(config.default ?? ""));
    const [errorMsg, setError] = useState<string | undefined>(undefined);
    const [value, setValue] = useState("");
    const prefix = usePrefix({ status, theme });

    async function validate(v: string): Promise<true | string> {
      const { required } = config;
      if (required && !v) return "You must provide a value";
      if (typeof config.validate === "function") {
        const r = await config.validate(v);
        if (r === true) return true;
        return typeof r === "string" ? r : "You must provide a valid value";
      }
      return true;
    }

    useKeypress(async (key, rl) => {
      // Shift+Tab → back. Check BEFORE the upstream isTabKey branch (which
      // would otherwise consume the shifted Tab as a default-value fill).
      if (isShiftTabKey(key)) {
        rl.clearLine(0);
        setStatus("done");
        done(BACK);
        return;
      }
      if (status !== "idle") return;
      if (isEnterKey(key)) {
        const answer = value || defaultValue;
        setStatus("loading");
        const isValid = await validate(answer);
        if (isValid === true) {
          setValue(answer);
          setStatus("done");
          done(answer);
        } else {
          if (theme.validationFailureMode === "clear") {
            setValue("");
          } else {
            rl.write(value);
          }
          setError(isValid);
          setStatus("idle");
        }
      } else if (isBackspaceKey(key) && !value) {
        setDefaultValue("");
      } else if (isTabKey(key) && !value) {
        // Plain Tab on empty input — accept default value (upstream behavior).
        setDefaultValue("");
        rl.clearLine(0);
        rl.write(defaultValue);
        setValue(defaultValue);
      } else {
        setValue(rl.line);
        setError(undefined);
      }
    });

    useEffect((rl) => {
      if (prefill === "editable" && defaultValue) {
        rl.write(defaultValue);
        setValue(defaultValue);
      }
    }, []);

    const message = theme.style.message(config.message, status);
    let formattedValue = value;
    if (typeof config.transformer === "function") {
      formattedValue = config.transformer(value, { isFinal: status === "done" });
    } else if (status === "done") {
      formattedValue = theme.style.answer(value);
    }
    let defaultStr: string | undefined;
    if (defaultValue && status !== "done" && !value) {
      defaultStr = theme.style.defaultAnswer(defaultValue);
    }
    let error = "";
    if (errorMsg) error = theme.style.error(errorMsg);
    const help =
      status === "done"
        ? ""
        : styleText("dim", "⏎ submit · Shift+Tab back");
    return [
      [prefix, message, defaultStr, formattedValue].filter((v) => v !== undefined).join(" "),
      [error, help].filter(Boolean).join("\n"),
    ];
  },
);

// ── confirm ───────────────────────────────────────────────────────────

interface BackableConfirmConfig {
  message: string;
  default?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  theme?: any;
  transformer?: (value: boolean) => string;
}

function getBooleanValue(value: string, defaultValue: boolean | undefined): boolean {
  let answer = defaultValue !== false;
  if (/^(y|yes)/i.test(value)) answer = true;
  else if (/^(n|no)/i.test(value)) answer = false;
  return answer;
}

function boolToString(value: boolean): string {
  return value ? "Yes" : "No";
}

export const backableConfirm = createPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config: BackableConfirmConfig, done: (value: boolean | Back) => void): any => {
    const { transformer = boolToString } = config;
    const [status, setStatus] = useState<"idle" | "done">("idle");
    const [value, setValue] = useState("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theme: any = makeTheme(config.theme as any);
    const prefix = usePrefix({ status, theme });

    useKeypress((key, rl) => {
      if (isShiftTabKey(key)) {
        rl.clearLine(0);
        setStatus("done");
        done(BACK);
        return;
      }
      if (status !== "idle") return;
      if (isEnterKey(key)) {
        const answer = getBooleanValue(value, config.default);
        setValue(transformer(answer));
        setStatus("done");
        done(answer);
      } else if (isTabKey(key)) {
        // Plain Tab — toggle Y/N (upstream behavior).
        const answer = boolToString(!getBooleanValue(value, config.default));
        rl.clearLine(0);
        rl.write(answer);
        setValue(answer);
      } else {
        setValue(rl.line);
      }
    });

    let formattedValue = value;
    let defaultValue = "";
    if (status === "done") {
      formattedValue = theme.style.answer(value);
    } else {
      defaultValue = ` ${theme.style.defaultAnswer(config.default === false ? "y/N" : "Y/n")}`;
    }
    const message = theme.style.message(config.message, status);
    const help =
      status === "done"
        ? ""
        : ` ${styleText("dim", "· Shift+Tab back")}`;
    return `${prefix} ${message}${defaultValue}${help} ${formattedValue}`;
  },
);

// ── Registration ─────────────────────────────────────────────────────

let registered = false;

/**
 * Replace inquirer's built-in select / checkbox / input / confirm prompts
 * with the Shift+Tab-backable forks. Idempotent. No-op when stdin is not
 * a TTY (CI / piped input — Shift+Tab is meaningless there and tests that
 * `vi.mock('inquirer', ...)` bypass the prompt registry entirely).
 *
 * Call once at CLI bootstrap, before any `inquirer.prompt(...)` call.
 */
export function registerBackablePrompts(): void {
  if (registered) return;
  if (!process.stdin.isTTY) return;
  registered = true;
  // The PromptFn signature inquirer expects matches createPrompt's return
  // type; the inquirer types are intentionally loose here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer.registerPrompt("select", backableSelect as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer.registerPrompt("checkbox", backableCheckbox as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer.registerPrompt("input", backableInput as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer.registerPrompt("confirm", backableConfirm as any);
}

/** Reset registration. Test-only — production code should not need this. */
export function __resetBackableRegistration(): void {
  registered = false;
}

// Re-export for the keypress helper unit test (not part of public surface).
export const __testing = { isShiftTabKey };
