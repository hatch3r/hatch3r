/**
 * D1-M4 (Cycle 10 Wave-3 Medium): Shared repo-identity prompt helper.
 *
 * Encapsulates the 3-branch (GitHub / Azure DevOps / GitLab) inquirer flow
 * that gathers the owner + repo + namespace + project tuple. Extracted from
 * `src/cli/commands/init.ts` (single-repo init step machine) so the same
 * platform-aware identity prompt can be reused by workspace init and any
 * future re-entry flow without copy-pasting the 30-line branch.
 *
 * Returns the literal `BACK` sentinel when any inquirer prompt yielded
 * BACK so the calling step machine can rewind one step.
 */
import inquirer from "inquirer";
import { BACK, isBack } from "./initSteps.js";
import { sanitizeInput } from "./constants.js";
import type { Platform } from "../../types.js";

/**
 * Tuple of repository identity fields persisted in `.hatch3r/hatch.json`.
 *
 * `owner` and `namespace` overlap for GitHub/GitLab (single-id platforms)
 * but split for Azure DevOps (org vs project). `repo` and `project` follow
 * the same pattern. Storing both keeps the manifest schema platform-neutral.
 */
export interface RepoIdentity {
  owner: string;
  repo: string;
  namespace: string;
  project: string;
}

/**
 * Optional defaults consumed by the prompt. `previous` carries forward the
 * last answers in BACK/forward navigation; `remote` carries git-remote
 * parser hints (owner, repo) detected at init time.
 */
export interface RepoIdentityDefaults {
  previous?: Partial<RepoIdentity>;
  remote?: { owner?: string; repo?: string };
}

/**
 * Prompt the user for the platform-specific repo identity. Returns the
 * sanitised identity tuple, or the `BACK` sentinel when the user navigated
 * back out of any of the prompts.
 */
export async function promptRepoIdentity(
  platform: Platform,
  defaults: RepoIdentityDefaults = {},
): Promise<RepoIdentity | typeof BACK> {
  const { previous, remote } = defaults;
  if (platform === "azure-devops") {
    const ado = await inquirer.prompt<{
      org: string | typeof BACK;
      project: string | typeof BACK;
      repo: string | typeof BACK;
    }>([
      { type: "input", name: "org", message: "Azure DevOps organization:", default: previous?.owner || remote?.owner || undefined },
      { type: "input", name: "project", message: "Azure DevOps project:", default: previous?.project || undefined },
      { type: "input", name: "repo", message: "Repository name:", default: previous?.repo || remote?.repo || undefined },
    ]);
    if (isBack(ado.org) || isBack(ado.project) || isBack(ado.repo)) return BACK;
    const owner = sanitizeInput(ado.org as string);
    return {
      owner,
      repo: sanitizeInput(ado.repo as string),
      namespace: owner,
      project: sanitizeInput(ado.project as string),
    };
  }
  if (platform === "gitlab") {
    const gl = await inquirer.prompt<{
      namespace: string | typeof BACK;
      project: string | typeof BACK;
    }>([
      { type: "input", name: "namespace", message: "GitLab namespace (group or username):", default: previous?.namespace || remote?.owner || undefined },
      { type: "input", name: "project", message: "Project name:", default: previous?.project || remote?.repo || undefined },
    ]);
    if (isBack(gl.namespace) || isBack(gl.project)) return BACK;
    const owner = sanitizeInput(gl.namespace as string);
    const repo = sanitizeInput(gl.project as string);
    return { owner, repo, namespace: owner, project: repo };
  }
  // Default branch: github
  const gh = await inquirer.prompt<{ owner: string | typeof BACK; repo: string | typeof BACK }>([
    { type: "input", name: "owner", message: "GitHub owner (org or username):", default: previous?.owner || remote?.owner || undefined },
    { type: "input", name: "repo", message: "Repository name:", default: previous?.repo || remote?.repo || undefined },
  ]);
  if (isBack(gh.owner) || isBack(gh.repo)) return BACK;
  const owner = sanitizeInput(gh.owner as string);
  const repo = sanitizeInput(gh.repo as string);
  return { owner, repo, namespace: owner, project: repo };
}
