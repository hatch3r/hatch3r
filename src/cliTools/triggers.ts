import type { CliToolId, Platform, RepoInfo } from "../types.js";
import {
  TIER2_CLI_TOOLS_BY_TRIGGER,
  type Tier2Trigger,
} from "./registry.js";

/**
 * Languages that mark a project as data-oriented for tier-2 trigger
 * evaluation. `RepoInfo.hasDataArtifacts` (csv/parquet/data-dir probe in
 * `src/detect/repoAnalyzer.ts::detectDataArtifacts`) is the stronger signal
 * and fires the trigger directly; this language proxy stays as the fallback
 * for data projects that ship code without root-level data artifacts.
 */
const DATA_LANGUAGES = new Set<string>(["python", "r", "sql"]);

/**
 * Frameworks that signal an interactive web project. Anything that ships
 * a browser-facing UI (Next, Nuxt, Astro, SvelteKit, Remix, Angular,
 * Vue, React, Svelte) opts into Playwright by default.
 */
const WEB_FRAMEWORKS = new Set<string>([
  "next",
  "nuxt",
  "astro",
  "sveltekit",
  "remix",
  "angular",
  "vue",
  "react",
  "svelte",
]);

/**
 * Evaluate which tier-2 trigger conditions hold for the active project.
 * Used by the picker to pre-check tools that the project clearly needs
 * (e.g. Playwright when `next` is in `frameworks`).
 *
 * `docker-detected` fires from `RepoInfo.hasDockerfile` (populated by
 * `analyzeRepo` via `detectDockerfile`). `ci-llm-project` is not evaluated
 * here — it needs a CI-workflow-content scan, not just a provider name
 * (Wave 4 work).
 */
export function evaluateTriggers(repoInfo: RepoInfo): Set<Tier2Trigger> {
  const active = new Set<Tier2Trigger>();

  // web-project — any web framework in repoInfo.frameworks.
  if (repoInfo.frameworks.some((f) => WEB_FRAMEWORKS.has(f))) {
    active.add("web-project");
  }

  // data-project — fires on a data-oriented language OR a root-level data
  // artifact (csv/parquet/data dir) detected by RepoInfo.hasDataArtifacts.
  if (repoInfo.languages.some((l) => DATA_LANGUAGES.has(l)) || repoInfo.hasDataArtifacts) {
    active.add("data-project");
  }

  // rust-project — Cargo.toml present.
  if (repoInfo.languages.includes("rust")) {
    active.add("rust-project");
  }

  // python-project — pyproject.toml / setup.py / Pipfile present.
  if (repoInfo.languages.includes("python")) {
    active.add("python-project");
  }

  // docker-detected — RepoInfo.hasDockerfile is set by analyzeRepo when a
  // Dockerfile / docker-compose / .devcontainer is present at the repo root.
  if (repoInfo.hasDockerfile) {
    active.add("docker-detected");
  }

  // ci-llm-project — out of scope for Wave 2; CI provider probe needs a
  // workflow-content scan, not just provider name. Wave 4 work.
  // (intentionally not evaluated)

  // interactive-tty — process.stdout.isTTY. Pre-check fzf/lazygit/difftastic
  // when running inside a real terminal. Non-TTY envs (CI) skip.
  if (process.stdout && process.stdout.isTTY) {
    active.add("interactive-tty");
  }

  return active;
}

/**
 * Resolve `evaluateTriggers` into the tier-2 tool ids the picker should
 * pre-check. Duplicates (e.g. `taplo` triggered by both rust and python)
 * are deduped via Set membership.
 */
export function evaluateTier2Triggers(repoInfo: RepoInfo): CliToolId[] {
  const triggers = evaluateTriggers(repoInfo);
  const ids = new Set<CliToolId>();
  for (const trigger of triggers) {
    for (const id of TIER2_CLI_TOOLS_BY_TRIGGER[trigger]) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Add platform-specific tier-2 tools to a base selection. Used by init's
 * `--yes` non-interactive path so a GitLab-hosted project automatically
 * picks up `glab`, and an Azure DevOps project picks up `az-devops`.
 *
 * GitHub-hosted projects do not get `gh` added here because `gh` is a
 * tier-1 default — already in the base set.
 */
export function applyPlatformTriggers(platform: Platform | undefined, base: readonly CliToolId[]): CliToolId[] {
  const out = new Set<CliToolId>(base);
  if (platform === "gitlab") {
    for (const id of TIER2_CLI_TOOLS_BY_TRIGGER["gitlab-remote"]) out.add(id);
  } else if (platform === "azure-devops") {
    for (const id of TIER2_CLI_TOOLS_BY_TRIGGER["azure-remote"]) out.add(id);
  }
  return [...out];
}
