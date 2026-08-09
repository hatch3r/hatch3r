import { toPrefixedId, type AdapterOutput } from "../types.js";
import { BaseAdapter, type AdapterContext } from "./base.js";

// Codex repository skills are directories under `$REPO_ROOT/.agents/skills`
// containing a `SKILL.md` with `name` and `description` frontmatter. Symlinked
// skill directories are also supported. Source: OpenAI, Build skills,
// https://learn.chatgpt.com/docs/build-skills (accessed 2026-08-09).
export class CodexAdapter extends BaseAdapter {
  readonly name = "codex";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    return this.processSkillsWithFmCliFiltered(
      ctx,
      (id) => `.agents/skills/${toPrefixedId(id)}/SKILL.md`,
    );
  }
}
