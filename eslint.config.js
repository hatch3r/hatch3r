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
 * Severity is "warn" so the existing 77-warning baseline shifts but the
 * build does not break. Cycle 7 H18 will convert the silent-null sites in
 * src/adapters/canonical.ts to channel-emitting alternatives.
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

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "silent-failure": silentFailurePlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "silent-failure/no-silent-catch": "warn",
    },
  },
);
