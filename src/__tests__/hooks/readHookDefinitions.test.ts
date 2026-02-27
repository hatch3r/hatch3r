import { describe, it, expect } from "vitest";
import { readHookDefinitions } from "../../hooks/index.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");
const EMPTY_DIR = resolveTestPath(import.meta.url, "../fixtures");

describe("readHookDefinitions", () => {
  it("reads hook definitions from the hooks directory", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    expect(hooks.length).toBe(2);
    const ids = hooks.map((h) => h.id).sort();
    expect(ids).toEqual(["pre-commit-lint-fixer", "session-start-ci-watcher"]);
  });

  it("parses event, agent, and description correctly", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const preCommit = hooks.find((h) => h.id === "pre-commit-lint-fixer");
    expect(preCommit).toBeDefined();
    expect(preCommit!.event).toBe("pre-commit");
    expect(preCommit!.agent).toBe("lint-fixer");
    expect(preCommit!.description).toBe("Run lint fixes before committing");
  });

  it("parses glob conditions from comma-separated values", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const preCommit = hooks.find((h) => h.id === "pre-commit-lint-fixer");
    expect(preCommit!.condition).toBeDefined();
    expect(preCommit!.condition!.globs).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
  });

  it("omits condition when no condition fields are present", async () => {
    const hooks = await readHookDefinitions(FIXTURES_DIR);

    const sessionStart = hooks.find((h) => h.id === "session-start-ci-watcher");
    expect(sessionStart!.condition).toBeUndefined();
  });

  it("returns empty array when hooks directory does not exist", async () => {
    const hooks = await readHookDefinitions(EMPTY_DIR);
    expect(hooks).toEqual([]);
  });
});
