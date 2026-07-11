import { vi } from "vitest";
import inquirer from "inquirer";

/**
 * D3-SA3.2-12 (D3, CQ5): shared NAME-KEYED inquirer mock helper for interactive
 * CLI tests. Test util — NOT shipped code.
 *
 * The suite's interactive tests answer prompts with a positional
 * `mockResolvedValueOnce` QUEUE. That queue is order-based, so any conditionally
 * inserted prompt (the documented `findMissingCliTools` / `offerInstaller` case)
 * shifts every downstream answer by one — historically surfacing as opaque
 * `Cannot destructure property 'proceed'/'syncRepos'` failures on CI, or, worse,
 * a syntactically-valid answer landing on the WRONG prompt and passing with
 * silently-wrong state (`src/__tests__/cli/init.test.ts` header + `config.test.ts`
 * both document this scar tissue).
 *
 * {@link mockPromptsByName} removes the order coupling: each `inquirer.prompt`
 * call is answered by reading the question's own `name` field and looking it up
 * in a keyed map. An UNREGISTERED prompt name throws a NAMED error — a loud,
 * self-describing failure instead of a silent positional shift.
 *
 * Adoption note (D3-SA3.2-12): the current init flow reuses `name: "tools"` for
 * BOTH the editor-tools prompt and the CLI-tools picker
 * (`src/cli/shared/flowSteps.ts` + `pickers.ts`). A name-keyed map cannot
 * distinguish two prompts sharing one name — so this helper drives flows without
 * that collision (e.g. `init --no-cli-tools`, which skips the CLI-tools picker)
 * until the source-side `cliTools` prompt rename lands. That rename +
 * retrofitting the colliding flows is tracked as the remaining half of the
 * finding.
 */
export type PromptAnswers = Record<string, unknown>;

/** One inquirer question, as passed to `inquirer.prompt` (single object or array). */
interface InquirerQuestionLike {
  name?: string;
}

/**
 * Install a name-keyed mock over `inquirer.prompt` (which must already be
 * `vi.fn()`-mocked at the module level — the CLI test files do this via
 * `vi.mock("inquirer", …)`). Every prompt call resolves an object whose keys are
 * the question `name`s and whose values come from `answers`.
 *
 * Throws (rejecting the `inquirer.prompt` promise) when:
 *   - a question has no string `name` (cannot be keyed), or
 *   - no answer is registered for a prompt's `name` (the anti-fragility contract:
 *     a mis-ordered / newly-inserted prompt fails by NAME, not silently).
 */
export function mockPromptsByName(answers: PromptAnswers): void {
  vi.mocked(inquirer.prompt).mockImplementation((async (questions: unknown): Promise<PromptAnswers> => {
    const list: InquirerQuestionLike[] = Array.isArray(questions)
      ? (questions as InquirerQuestionLike[])
      : [questions as InquirerQuestionLike];
    const result: PromptAnswers = {};
    for (const q of list) {
      const name = q?.name;
      if (typeof name !== "string") {
        throw new Error(
          `mockPromptsByName: inquirer question is missing a string 'name' field: ${JSON.stringify(q)}`,
        );
      }
      if (!Object.prototype.hasOwnProperty.call(answers, name)) {
        throw new Error(
          `mockPromptsByName: no mock answer registered for prompt '${name}'. ` +
            `Registered names: [${Object.keys(answers).join(", ")}]. ` +
            `(A new or conditionally-inserted prompt appeared — add it to the answer map.)`,
        );
      }
      result[name] = answers[name];
    }
    return result;
  }) as never);
}
