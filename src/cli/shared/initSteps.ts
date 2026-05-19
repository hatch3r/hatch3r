import inquirer from "inquirer";

/**
 * Step-machine driver for `hatch3r init`'s interactive flow.
 *
 * Each prompt is modelled as a {@link Step} that returns either a value
 * for its slot in the state object or the {@link BACK} sentinel. The
 * driver walks the step list forward; when a step returns BACK, the
 * driver re-renders the previous non-skipped step with the user's prior
 * answer pre-selected as the default.
 *
 * The helpers ({@link askSelect}, {@link askCheckbox}, {@link askConfirm},
 * {@link askInput}) wrap `inquirer.prompt` so the BACK affordance is
 * uniform: select/checkbox prompts get a prepended "← Back" choice and a
 * `(or ← Back)` hint on the message; text inputs accept the literal
 * `:back` (whitespace-trimmed) and append `(type :back to go back)` to
 * the prompt.
 *
 * The helpers pass the caller-supplied `name` through to inquirer so that
 * existing tests (which queue answers shaped like `{ platform: "github" }`)
 * keep working unchanged.
 */

/** Opaque sentinel returned when the user wants to walk back one step. */
export const BACK: unique symbol = Symbol("BACK");
export type Back = typeof BACK;

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
 * Prompt with a single-choice list. Prepends a "← Back" entry so the
 * user can walk back one step. Returns BACK or the selected value.
 */
export async function askSelect<T>(
  args: AskSelectArgs<T>,
): Promise<StepResult<T>> {
  const backChoice = { name: "← Back", value: BACK as unknown as T };
  const choices = [backChoice, ...args.choices];
  const answer = await inquirer.prompt<Record<string, T>>([
    {
      type: "select",
      name: args.name,
      message: `${args.message} (or ← Back)`,
      choices,
      ...(args.default !== undefined ? { default: args.default } : {}),
    },
  ]);
  const value = answer[args.name];
  return isBack(value) ? BACK : value;
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
 * Prompt with a multi-choice list. Prepends a "← Back" toggle; if the
 * user selects it (alone or alongside real values), returns BACK. Pass-
 * through callers that already build inquirer.Separator choices keep
 * working — separators are forwarded unchanged.
 */
export async function askCheckbox<T>(
  args: AskCheckboxArgs<T>,
): Promise<StepResult<T[]>> {
  const backChoice = { name: "← Back", value: BACK as unknown as T };
  const choices = [backChoice, ...args.choices];
  const answer = await inquirer.prompt<Record<string, T[]>>([
    {
      type: "checkbox",
      name: args.name,
      message: `${args.message} (or ← Back)`,
      choices,
      ...(args.default !== undefined ? { default: args.default } : {}),
    },
  ]);
  const values = answer[args.name] ?? [];
  if (Array.isArray(values) && values.some(isBack)) return BACK;
  return values.filter((v) => !isBack(v));
}

interface AskConfirmArgs {
  name: string;
  message: string;
  default?: boolean;
}

/**
 * Confirm prompts (yes/no) have no BACK affordance — the user only types
 * one letter so a third option would clutter the UI. Walk back to a
 * confirm via the NEXT step's ← Back. Returns the boolean answer.
 *
 * Wrapped in StepResult for type uniformity; it never returns BACK.
 */
export async function askConfirm(
  args: AskConfirmArgs,
): Promise<StepResult<boolean>> {
  const answer = await inquirer.prompt<Record<string, boolean>>([
    {
      type: "confirm",
      name: args.name,
      message: args.message,
      ...(args.default !== undefined ? { default: args.default } : {}),
    },
  ]);
  return answer[args.name];
}

interface AskInputArgs {
  name: string;
  message: string;
  default?: string;
  validate?: (s: string) => boolean | string;
}

/**
 * Text input prompt. The literal string `:back` (after `trim()`) walks
 * the user back one step. The `:back` check runs BEFORE the caller's
 * `validate` callback so back-navigation always succeeds regardless of
 * validator strictness.
 */
export async function askInput(
  args: AskInputArgs,
): Promise<StepResult<string>> {
  const wrappedValidate = args.validate
    ? (v: string): boolean | string => {
        if (v.trim() === ":back") return true;
        return args.validate!(v);
      }
    : undefined;
  const answer = await inquirer.prompt<Record<string, string>>([
    {
      type: "input",
      name: args.name,
      message: `${args.message} (type :back to go back)`,
      ...(args.default !== undefined ? { default: args.default } : {}),
      ...(wrappedValidate ? { validate: wrappedValidate } : {}),
    },
  ]);
  const value = answer[args.name] ?? "";
  if (value.trim() === ":back") return BACK;
  return value;
}
