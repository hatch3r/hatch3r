import tseslint from "typescript-eslint";

/**
 * Cycle 7 H11 — Silent Failure Contract.
 *
 * Local ESLint rule enforcing CONSTITUTION.md §2 P5 "Silent Failure Contract":
 *   Every catch block in src/ MUST emit a diagnostic via warnings[],
 *   observability, or failureLog. Catch-and-skip without channel emission
 *   is a contract violation.
 *
 * The rule flags catch blocks whose body either:
 *   - is empty (`catch {}` or `catch (e) {}`), or
 *   - contains only return statements (`catch (e) { return null; }`,
 *     `catch (e) { return []; }`, `catch (e) { return; }`, etc.).
 *
 * It does NOT flag catches that re-throw, log, push to a warnings array,
 * call any function, assign to anything, or contain control flow other
 * than a single bare return.
 *
 * Opt-out: prepend `// eslint-disable-next-line silent-failure/no-silent-catch`
 * with a justification comment (the disable comment itself satisfies eslint;
 * the project convention is to add a one-line `// reason: ...` above it).
 *
 * Severity is "error" as of Cycle 9 H19 — the silent-failure sweep cleared
 * all 76 outstanding sites by emitting a verbose() diagnostic from every
 * previously-empty/pure-return catch, satisfying CONSTITUTION.md §2 P5
 * Silent Failure Contract. Promotion from "warn" to "error" prevents new
 * silent catches from landing without per-site `// eslint-disable-next-line
 * silent-failure/no-silent-catch` with a justification comment.
 */
const silentFailurePlugin = {
  meta: { name: "silent-failure", version: "1.0.0" },
  rules: {
    "no-silent-catch": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow catch blocks that swallow errors without emitting a diagnostic (empty body or pure return). See CONSTITUTION.md §2 P5 Silent Failure Contract.",
        },
        schema: [],
        messages: {
          empty:
            "Empty catch block silently swallows the error. Emit via warnings[], observability, or failureLog (CONSTITUTION.md §2 P5).",
          returnOnly:
            "Catch block returns without emitting a diagnostic. Push to warnings[]/observability/failureLog before returning, or re-throw if unrecoverable (CONSTITUTION.md §2 P5).",
        },
      },
      create(context) {
        return {
          CatchClause(node) {
            const body = node.body && node.body.body ? node.body.body : [];
            if (body.length === 0) {
              context.report({ node, messageId: "empty" });
              return;
            }
            // Pure-return body: catch contributes no diagnostic channel.
            const onlyReturns = body.every(
              (stmt) => stmt.type === "ReturnStatement",
            );
            if (onlyReturns) {
              context.report({ node, messageId: "returnOnly" });
            }
          },
        };
      },
    },
  },
};

/**
 * Cycle 7 H14 — HatchError Migration Contract.
 *
 * Local ESLint rule enforcing CLI UX Standards (.claude/rules/cli-ux-standards.md):
 *   Every `throw new Error(...)` in src/ MUST use HatchError so the CLI emits a
 *   structured exitCode + machine-readable errorCode for programmatic recovery.
 *
 * The rule flags `throw new Error(...)` (callee Identifier "Error") as a warning.
 * It does NOT flag:
 *   - HatchError, TypeError, RangeError, etc. (any other Identifier)
 *   - Re-thrown caught errors (`throw err`)
 *   - Member-expression callees (`throw new SomeNs.Error(...)`)
 *
 * Scope: src/**\/*.ts excluding src/__tests__/** (tests use plain Error to
 * simulate failures in mock adapters and process.exit guards).
 *
 * Severity is "warn" so any future regression surfaces in lint output without
 * breaking the build, matching the silent-failure precedent.
 */
const hatchErrorPlugin = {
  meta: { name: "hatch-error", version: "1.0.0" },
  rules: {
    "use-hatch-error": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require HatchError instead of plain Error for thrown errors so the CLI emits structured exitCode and errorCode (.claude/rules/cli-ux-standards.md).",
        },
        schema: [],
        messages: {
          plainError:
            "Use HatchError instead of plain Error. Replace `throw new Error(msg)` with `throw new HatchError(msg, exitCode, errorCode)` so the CLI surfaces a structured exit code (.claude/rules/cli-ux-standards.md).",
        },
      },
      create(context) {
        return {
          ThrowStatement(node) {
            const arg = node.argument;
            if (!arg || arg.type !== "NewExpression") return;
            const callee = arg.callee;
            if (callee.type !== "Identifier") return;
            if (callee.name !== "Error") return;
            context.report({ node, messageId: "plainError" });
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "silent-failure": silentFailurePlugin,
      "hatch-error": hatchErrorPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "silent-failure/no-silent-catch": "error",
      "hatch-error/use-hatch-error": "warn",
    },
  },
  {
    // Tests intentionally throw plain Error to simulate adapter/process failures
    // (e.g. `throw new Error("simulated cursor failure")`, `throw new Error("process.exit called")`).
    files: ["src/__tests__/**/*.ts"],
    rules: {
      "hatch-error/use-hatch-error": "off",
    },
  },
);
