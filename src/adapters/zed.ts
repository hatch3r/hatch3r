import type { AdapterOutput } from "../types.js";
import { wrapInManagedBlock } from "../merge/managedBlocks.js";
import { BaseAdapter, output, type AdapterContext } from "./base.js";

export class ZedAdapter extends BaseAdapter {
  readonly name = "zed";

  protected async doGenerate(ctx: AdapterContext): Promise<AdapterOutput[]> {
    const inner = [
      ...this.bridgeHeader(),
      ...await this.inlineRules(ctx),
      ...await this.inlineAgents(ctx),
    ].join("\n");
    return [output(".rules", wrapInManagedBlock(inner), inner)];
  }
}
