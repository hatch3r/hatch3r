/**
 * Language-aware verification gate commands.
 *
 * Finding #72 (D14, High): Abstract verification gates so they use the
 * project's native commands rather than assuming npm. The gate resolver
 * inspects detected languages and returns the correct test, lint, and
 * typecheck commands.
 */

// ── Types ────────────────────────────────────────────────────────

export interface VerificationGateCommands {
  /** Command to run the project's test suite. */
  test: string;
  /** Command to run the project's linter. */
  lint: string;
  /** Command to run type checking (if applicable). */
  typecheck: string | null;
  /** Combined command to run all gates sequentially. */
  all: string;
}

// ── Language gate definitions ─────────────────────────────────────

interface LanguageGateConfig {
  language: string;
  test: string;
  lint: string;
  typecheck: string | null;
}

const LANGUAGE_GATE_CONFIGS: readonly LanguageGateConfig[] = [
  {
    language: "typescript",
    test: "npm run test",
    lint: "npm run lint",
    typecheck: "npm run typecheck",
  },
  {
    language: "javascript",
    test: "npm run test",
    lint: "npm run lint",
    typecheck: null,
  },
  {
    language: "python",
    test: "pytest",
    lint: "ruff check .",
    typecheck: "mypy .",
  },
  {
    language: "go",
    test: "go test ./...",
    lint: "golangci-lint run",
    typecheck: "go vet ./...",
  },
  {
    language: "rust",
    test: "cargo test",
    lint: "cargo clippy -- -D warnings",
    typecheck: "cargo check",
  },
  {
    language: "java",
    test: "mvn test",
    lint: "mvn checkstyle:check",
    typecheck: null,
  },
  {
    language: "ruby",
    test: "bundle exec rspec",
    lint: "bundle exec rubocop",
    typecheck: null,
  },
  {
    language: "kotlin",
    test: "gradle test",
    lint: "gradle ktlintCheck",
    typecheck: null,
  },
  {
    language: "php",
    test: "vendor/bin/phpunit",
    lint: "vendor/bin/phpstan analyse",
    typecheck: null,
  },
  {
    language: "swift",
    test: "swift test",
    lint: "swiftlint",
    typecheck: null,
  },
  {
    language: "dart",
    test: "dart test",
    lint: "dart analyze",
    typecheck: null,
  },
  {
    language: "elixir",
    test: "mix test",
    lint: "mix credo",
    typecheck: "mix dialyzer",
  },
  {
    language: "csharp",
    test: "dotnet test",
    lint: "dotnet format --verify-no-changes",
    typecheck: "dotnet build --no-restore",
  },
] as const;

/**
 * Package-manager-aware npm command overrides.
 *
 * When the detected package manager is not npm, rewrite "npm run X" to
 * the equivalent command for the detected package manager.
 */
const PM_RUN_PREFIX: Record<string, string> = {
  npm: "npm run",
  yarn: "yarn",
  pnpm: "pnpm run",
  bun: "bun run",
};

// ── Public API ───────────────────────────────────────────────────

/**
 * Default fallback gate commands (npm-based, for backward compatibility).
 */
export const DEFAULT_GATE_COMMANDS: VerificationGateCommands = {
  test: "npm run test",
  lint: "npm run lint",
  typecheck: "npm run typecheck",
  all: "npm run lint && npm run typecheck && npm run test",
};

/**
 * Resolve verification gate commands for a project based on its
 * detected languages and package manager.
 *
 * Priority: first detected language wins. If the primary language is
 * JS/TS, the package manager determines the run prefix.
 *
 * @param languages - Detected project languages (from repoAnalyzer)
 * @param packageManager - Detected package manager name (npm, yarn, pnpm, bun)
 */
export function resolveVerificationGates(
  languages: string[],
  packageManager?: string,
): VerificationGateCommands {
  if (languages.length === 0 || (languages.length === 1 && languages[0] === "unknown")) {
    return DEFAULT_GATE_COMMANDS;
  }

  // Find the first matching language config
  const primary = languages[0];
  const config = LANGUAGE_GATE_CONFIGS.find((c) => c.language === primary);

  if (!config) {
    return DEFAULT_GATE_COMMANDS;
  }

  let test = config.test;
  let lint = config.lint;
  let typecheck = config.typecheck;

  // For JS/TS projects, adjust for the detected package manager
  if ((primary === "typescript" || primary === "javascript") && packageManager) {
    const prefix = PM_RUN_PREFIX[packageManager] ?? "npm run";
    if (prefix !== "npm run") {
      test = test.replace("npm run", prefix);
      lint = lint.replace("npm run", prefix);
      if (typecheck) {
        typecheck = typecheck.replace("npm run", prefix);
      }
    }
  }

  const parts = [lint, typecheck, test].filter(Boolean) as string[];
  const all = parts.join(" && ");

  return { test, lint, typecheck, all };
}

/**
 * Get the gate config for a specific language (for direct lookup).
 */
export function getLanguageGateConfig(language: string): LanguageGateConfig | undefined {
  return LANGUAGE_GATE_CONFIGS.find((c) => c.language === language);
}
