import { describe, it, expect } from "vitest";
import {
  resolveVerificationGates,
  DEFAULT_GATE_COMMANDS,
  getLanguageGateConfig,
} from "../../detect/verificationGates.js";
import { DETECTABLE_LANGUAGES } from "../../detect/repoAnalyzer.js";

describe("resolveVerificationGates", () => {
  describe("default fallback", () => {
    it("returns npm defaults for empty languages", () => {
      const gates = resolveVerificationGates([]);
      expect(gates).toEqual(DEFAULT_GATE_COMMANDS);
    });

    it("returns npm defaults for ['unknown']", () => {
      const gates = resolveVerificationGates(["unknown"]);
      expect(gates).toEqual(DEFAULT_GATE_COMMANDS);
    });

    it("returns npm defaults for unrecognized language", () => {
      const gates = resolveVerificationGates(["brainfuck"]);
      expect(gates).toEqual(DEFAULT_GATE_COMMANDS);
    });
  });

  describe("TypeScript projects", () => {
    it("returns npm commands for TypeScript with npm", () => {
      const gates = resolveVerificationGates(["typescript"], "npm");
      expect(gates.test).toBe("npm run test");
      expect(gates.lint).toBe("npm run lint");
      expect(gates.typecheck).toBe("npm run typecheck");
      expect(gates.all).toBe("npm run lint && npm run typecheck && npm run test");
    });

    it("adjusts commands for pnpm", () => {
      const gates = resolveVerificationGates(["typescript"], "pnpm");
      expect(gates.test).toBe("pnpm run test");
      expect(gates.lint).toBe("pnpm run lint");
      expect(gates.typecheck).toBe("pnpm run typecheck");
    });

    it("adjusts commands for yarn", () => {
      const gates = resolveVerificationGates(["typescript"], "yarn");
      expect(gates.test).toBe("yarn test");
      expect(gates.lint).toBe("yarn lint");
      expect(gates.typecheck).toBe("yarn typecheck");
    });

    it("adjusts commands for bun", () => {
      const gates = resolveVerificationGates(["typescript"], "bun");
      expect(gates.test).toBe("bun run test");
      expect(gates.lint).toBe("bun run lint");
      expect(gates.typecheck).toBe("bun run typecheck");
    });

    it("defaults to npm when no package manager specified", () => {
      const gates = resolveVerificationGates(["typescript"]);
      expect(gates.test).toBe("npm run test");
    });
  });

  describe("JavaScript projects", () => {
    it("returns npm commands without typecheck", () => {
      const gates = resolveVerificationGates(["javascript"], "npm");
      expect(gates.test).toBe("npm run test");
      expect(gates.lint).toBe("npm run lint");
      expect(gates.typecheck).toBeNull();
      expect(gates.all).toBe("npm run lint && npm run test");
    });

    it("adjusts for yarn", () => {
      const gates = resolveVerificationGates(["javascript"], "yarn");
      expect(gates.test).toBe("yarn test");
      expect(gates.lint).toBe("yarn lint");
    });
  });

  describe("Python projects", () => {
    it("returns pytest and ruff commands", () => {
      const gates = resolveVerificationGates(["python"]);
      expect(gates.test).toBe("pytest");
      expect(gates.lint).toBe("ruff check .");
      expect(gates.typecheck).toBe("mypy .");
      expect(gates.all).toBe("ruff check . && mypy . && pytest");
    });
  });

  describe("Go projects", () => {
    it("returns go test and golangci-lint commands", () => {
      const gates = resolveVerificationGates(["go"]);
      expect(gates.test).toBe("go test ./...");
      expect(gates.lint).toBe("golangci-lint run");
      expect(gates.typecheck).toBe("go vet ./...");
      expect(gates.all).toBe("golangci-lint run && go vet ./... && go test ./...");
    });
  });

  describe("Rust projects", () => {
    it("returns cargo commands", () => {
      const gates = resolveVerificationGates(["rust"]);
      expect(gates.test).toBe("cargo test");
      expect(gates.lint).toBe("cargo clippy -- -D warnings");
      expect(gates.typecheck).toBe("cargo check");
    });
  });

  describe("Java projects", () => {
    it("returns maven commands", () => {
      const gates = resolveVerificationGates(["java"]);
      expect(gates.test).toBe("mvn test");
      expect(gates.lint).toBe("mvn checkstyle:check");
      expect(gates.typecheck).toBeNull();
      expect(gates.all).toBe("mvn checkstyle:check && mvn test");
    });
  });

  describe("Ruby projects", () => {
    it("returns bundler/rspec commands", () => {
      const gates = resolveVerificationGates(["ruby"]);
      expect(gates.test).toBe("bundle exec rspec");
      expect(gates.lint).toBe("bundle exec rubocop");
      expect(gates.typecheck).toBeNull();
    });
  });

  describe("C# projects", () => {
    it("returns dotnet commands", () => {
      const gates = resolveVerificationGates(["csharp"]);
      expect(gates.test).toBe("dotnet test");
      expect(gates.lint).toBe("dotnet format --verify-no-changes");
      expect(gates.typecheck).toBe("dotnet build --no-restore");
    });
  });

  describe("Elixir projects", () => {
    it("returns mix commands", () => {
      const gates = resolveVerificationGates(["elixir"]);
      expect(gates.test).toBe("mix test");
      expect(gates.lint).toBe("mix credo");
      expect(gates.typecheck).toBe("mix dialyzer");
    });
  });

  describe("D1-SA1.6-11: native gates for the six previously-unmapped languages", () => {
    it.each([
      ["scala", "sbt test", "sbt scalafmtCheckAll", "sbt compile"],
      ["zig", "zig build test", "zig fmt --check .", null],
      ["ocaml", "dune test", "dune build @fmt", "dune build"],
      ["haskell", "stack test", "hlint .", "stack build"],
      ["clojure", "lein test", "clj-kondo --lint src", null],
      ["lua", "busted", "luacheck .", null],
    ] as const)("maps %s to its native toolchain, not npm defaults", (lang, test, lint, typecheck) => {
      const gates = resolveVerificationGates([lang]);
      expect(gates.test).toBe(test);
      expect(gates.lint).toBe(lint);
      expect(gates.typecheck).toBe(typecheck);
      expect(gates).not.toEqual(DEFAULT_GATE_COMMANDS);
    });
  });

  describe("multi-language projects", () => {
    it("uses the first detected language for gate commands", () => {
      const gates = resolveVerificationGates(["python", "typescript"]);
      expect(gates.test).toBe("pytest");
      expect(gates.lint).toBe("ruff check .");
    });
  });
});

describe("getLanguageGateConfig", () => {
  it("returns config for known language", () => {
    const config = getLanguageGateConfig("python");
    expect(config).toBeDefined();
    expect(config!.test).toBe("pytest");
  });

  it("returns undefined for unknown language", () => {
    const config = getLanguageGateConfig("brainfuck");
    expect(config).toBeUndefined();
  });

  // D1-SA1.6-11: bind the two lists that previously drifted — every language
  // repoAnalyzer can positively detect (DETECTABLE_LANGUAGES) must have a gate
  // row, so a future indicator addition without a matching gate fails here
  // instead of silently emitting npm commands into a non-npm repo.
  it("returns a config for every detectable language (indicator ↔ gate exhaustiveness)", () => {
    for (const lang of DETECTABLE_LANGUAGES) {
      expect(
        getLanguageGateConfig(lang),
        `missing gate config for detectable language '${lang}'`,
      ).toBeDefined();
    }
  });
});

describe("DEFAULT_GATE_COMMANDS", () => {
  it("uses npm-based commands", () => {
    expect(DEFAULT_GATE_COMMANDS.test).toBe("npm run test");
    expect(DEFAULT_GATE_COMMANDS.lint).toBe("npm run lint");
    expect(DEFAULT_GATE_COMMANDS.typecheck).toBe("npm run typecheck");
  });

  it("has a combined 'all' command", () => {
    expect(DEFAULT_GATE_COMMANDS.all).toContain("&&");
    expect(DEFAULT_GATE_COMMANDS.all).toContain("npm run lint");
    expect(DEFAULT_GATE_COMMANDS.all).toContain("npm run test");
  });
});
