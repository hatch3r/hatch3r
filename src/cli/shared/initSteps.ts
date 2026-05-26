import inquirer from "inquirer";

/**
 * Step-machine driver for hatch3r's multi-step interactive flows.
 *
 * Each prompt is modelled as a {@link Step} that returns either a value
 * for its slot in the state object or the {@link BACK} sentinel. The
 * driver walks the step list forward; when a step returns BACK, the
 * driver re-renders the previous non-skipped step with the user's prior
 * answer pre-selected as the default.
 *
 * BACK is signalled by the **Shift+Tab** keypress in any prompt rendered
 * by `src/cli/shared/backablePrompts.ts` (registered at CLI bootstrap).
 * The helpers in this file (`askSelect`, `askCheckbox`, `askConfirm`,
 * `askInput`) translate the keypress-resolved answer into a typed
 * StepResult — no per-prompt back affordance is required at call sites.
 *
 * The helpers pass the caller-supplied `name` through to inquirer so
 * existing tests (which queue answers shaped like `{ platform: "github" }`)
 * keep working unchanged.
 */

/**
 * Opaque sentinel returned when the user wants to walk back one step.
 *
 * Uses `Symbol.for` so identity holds across module boundaries — this is
 * required because the backable prompts (in `backablePrompts.ts`) resolve
 * with the same sentinel and the comparison must succeed across separate
 * module instances (production code vs. vitest-mocked modules).
 */
export const BACK: symbol = Symbol.for("hatch3r.BACK");
export type Back = symbol;

/** Either a real answer of type T or the BACK sentinel. */
export type StepResult<T> = T | Back;

export function isBack(v: unknown): v is Back {
  return v === BACK;
}

/**
 * One step is parameterized by a single key K of TState. The mapped-type
 * helper below builds the discriminated union so callers can list steps
 * with mixed key types in one array.
 */
export interface StepFor<TState extends object, K extends keyof TState> {
  /** State slot this step fills. */
  id: K;
  /** Optional skip predicate evaluated against in-progress state. */
  skip?(state: Partial<TState>): boolean;
  /**
   * Execute the prompt. `previous` is the value the user supplied on a
   * prior visit (when re-entering via BACK) — wire it through as the
   * default so the prior choice stays selected.
   */
  run(
    state: Partial<TState>,
    previous: TState[K] | undefined,
  ): Promise<StepResult<TState[K]>>;
}

export type Step<TState extends object, _K extends keyof TState = keyof TState> =
  { [K in keyof TState]: StepFor<TState, K> }[keyof TState];

/**
 * Drive the step list to completion.
 *
 * BACK on step 0 is a no-op (re-prompts the same step). BACK on any
 * later step walks backward past skipped steps to the nearest live
 * step; that step re-renders with the user's prior answer as default.
 * Flipping a gate on the way back (e.g. `wantMcp: true → false`) causes
 * the now-skipped step to be cleared from state on the next forward
 * pass — the orchestrator sees `state[key]` as `undefined` for skipped
 * downstream slots.
 */
export async function runStepMachine<TState extends object>(
  steps: Array<Step<TState>>,
): Promise<TState> {
  const state: Partial<TState> = {};
  const prev: Partial<TState> = {};

  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.skip?.(state)) {
      // Skipped steps must not leak stale answers from a prior pass
      // (the MCP-gate-flip test verifies this).
      delete state[step.id];
      i++;
      continue;
    }

    // Cast through `any` once at the seam: the step.id ↔ run() relationship
    // is enforced statically by the discriminated `Step` union; reading
    // `prev[step.id]` and writing `state[step.id]` blow past TS' inability
    // to correlate the union members at the index access.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const previousAnswer: any = prev[step.id];
    const result = await step.run(state, previousAnswer);

    if (isBack(result)) {
      if (i === 0) {
        // First-step BACK is a no-op: re-prompt the same step.
        continue;
      }
      let j = i - 1;
      while (j > 0 && steps[j].skip?.(state)) j--;
      // If we land on a still-skipped step (only possible at j=0), the
      // outer loop will skip it again on the next iteration.
      i = j;
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state as any)[step.id] = result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prev as any)[step.id] = result;
    i++;
  }

  return state as TState;
}

// ── Helper wrappers ─────────────────────────────────────────────────

interface AskSelectArgs<T> {
  name: string;
  message: string;
  choices: Array<{ name: string; value: T }>;
  default?: T;
}

/**
 * Prompt with a single-choice list. Returns BACK when the user presses
 * Shift+Tab (delivered by the backable prompts registered in
 * `backablePrompts.ts`), or the selected value otherwise.
 */
export async function askSelect<T>(
  args: AskSelectArgs<T>,
): Promise<StepResult<T>> {
  const answer = await inquirer.prompt<Record<string, T | Back>>([
    {
      type: "select",
      name: args.name,
      message: args.message,
      choices: args.choices,
      ...(args.default !== undefined ? { default: args.default } : {}),
    },
  ]);
  const value = answer[args.name];
  return isBack(value) ? BACK : (value as T);
}

interface AskCheckboxArgs<T> {
  name: string;
  message: string;
  choices: Array<
    | { name: string; value: T; checked?: boolean }
    | { type: "separator"; line: string }
    | InstanceType<typeof inquirer.Separator>
  >;
  default?: T[];
}

/**
 * Prompt with a multi-choice list. Returns BACK on Shift+Tab, the array
 * of selected values otherwise. Separators are forwarded unchanged to
 * inquirer (the tier-grouping pattern used by `pickers.ts`).
 */
export async function askCheckbox<T>(
  args: AskCheckboxArgs<T>,
): Promise<StepResult<T[]>> {
  const answer = await inquirer.prompt<Record<string, T[] | Back>>([
    {
      type: "checkbox",
      name: args.name,
      message: args.message,
      choices: args.choices,
      ...(args.default !== undefined ? { default: args.default } : {}),
    },
  ]);
  const value = answer[args.name];
  if (isBack(value)) return BACK;
  return (value ?? []) as T[];
}

interface AskConfirmArgs {
  name: string;
  message: string;
  default?: boolean;
}

/**
 * Confirm prompt (yes/no). Returns BACK on Shift+Tab, the boolean answer
 * otherwise. (Confirm prompts gained back-nav with the Shift+Tab refactor —
 * previously a documented limitation.)
 */
export async function askConfirm(
  args: AskConfirmArgs,
): Promise<StepResult<boolean>> {
  const answer = await inquirer.prompt<Record<string, boolean | Back>>([
    {
      type: "confirm",
      name: args.name,
      message: args.message,
      ...(args.default !== undefined ? { default: args.default } : {}),
    },
  ]);
  const value = answer[args.name];
  return isBack(value) ? BACK : (value as boolean);
}

interface AskInputArgs {
  name: string;
  message: string;
  default?: string;
  validate?: (s: string) => boolean | string;
}

/**
 * Text input prompt. Returns BACK on Shift+Tab, the typed string otherwise
 * (or the default when the user submits empty input). Caller-supplied
 * validators see only real string values — Shift+Tab is intercepted at
 * the prompt level before validation runs.
 */
export async function askInput(
  args: AskInputArgs,
): Promise<StepResult<string>> {
  const answer = await inquirer.prompt<Record<string, string | Back>>([
    {
      type: "input",
      name: args.name,
      message: args.message,
      ...(args.default !== undefined ? { default: args.default } : {}),
      ...(args.validate ? { validate: args.validate } : {}),
    },
  ]);
  const value = answer[args.name];
  return isBack(value) ? BACK : (value as string);
}
