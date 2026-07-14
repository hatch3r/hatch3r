import { describe, it, expect, vi, afterEach } from "vitest";
import { predictMergeAction } from "../../merge/safeWrite.js";

// ───────────────────────────────────────────────────────────────────────────
// predictMergeAction — pure (no I/O) MergeResult.action predictor used by
// `hatch3r sync --dry-run` (D11-SA11.2-F9). Each test asserts the predicted
// action vocabulary matches the documented safeWriteFile branch-for-branch
// decision logic. The predictor MUST produce the same action a live write
// would, so a dry-run preview does not diverge from the subsequent live sync.
// ───────────────────────────────────────────────────────────────────────────

const START = "<!-- HATCH3R:BEGIN -->";
const END = "<!-- HATCH3R:END -->";

describe("predictMergeAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("absent file", () => {
    it("predicts 'created' when existingContent is null (file does not exist)", () => {
      expect(predictMergeAction(null, "new body", "AGENTS.md")).toBe("created");
    });

    it("predicts 'created' even with managedContent when file is absent", () => {
      expect(
        predictMergeAction(null, "x", "AGENTS.md", { managedContent: "m" }),
      ).toBe("created");
    });
  });

  describe("managedContent + existing file WITHOUT a managed block", () => {
    it("predicts 'skipped' when appendIfNoBlock is absent (would-be-skip case)", () => {
      const existing = "# user file with no markers\n";
      expect(
        predictMergeAction(existing, "", "AGENTS.md", { managedContent: "m" }),
      ).toBe("skipped");
    });

    it("predicts 'updated' when appendIfNoBlock prepends new bytes", () => {
      const existing = "# user content\n";
      const action = predictMergeAction(existing, "managed body", "AGENTS.md", {
        managedContent: "managed body",
        appendIfNoBlock: true,
      });
      expect(action).toBe("updated");
    });

    it("predicts 'unchanged' when whitespace-only content makes the prepend a no-op", () => {
      // The appendIfNoBlock 'unchanged' equality IS reachable, contrary to an
      // earlier "prepended bytes are strictly longer than existing → unreachable"
      // rationalization: when `content` trims to empty, the prepend
      // `[content.trim(), "", existing.trimStart()].join("\n")` reduces to
      // "\n\n" + existing.trimStart(). For an existing no-block file that is
      // itself "\n\n" + trimmed-body + "\n", prepended === existing, so both this
      // predictor (safeWrite.ts:578) and the live write (safeWrite.ts:689-690)
      // return 'unchanged'. The live-path counterpart is covered in
      // safeWrite.test.ts ("appendIfNoBlock with whitespace-only content ...").
      const existing = "\n\nhello world\n";
      const action = predictMergeAction(existing, "", "AGENTS.md", {
        managedContent: "irrelevant-but-truthy",
        appendIfNoBlock: true,
      });
      expect(action).toBe("unchanged");
    });

    it("predicts 'updated' even when skipIfUnchanged is false on the appendIfNoBlock path", () => {
      // With skipIfUnchanged off, the 'unchanged' short-circuit (safeWrite.ts:578)
      // is bypassed, so even a no-op prepend predicts 'updated' (the live write
      // would re-emit byte-identical content rather than skip).
      const existing = "# user content\n";
      const action = predictMergeAction(existing, "managed body", "AGENTS.md", {
        managedContent: "managed body",
        appendIfNoBlock: true,
        skipIfUnchanged: false,
      });
      expect(action).toBe("updated");
    });
  });

  describe("managedContent + existing file WITH a managed block", () => {
    it("predicts 'updated' when the merge changes bytes", () => {
      const existing = `${START}\nold body\n${END}\n\n# user\n`;
      const action = predictMergeAction(existing, "", "AGENTS.md", {
        managedContent: "new body",
      });
      expect(action).toBe("updated");
    });

    it("predicts 'unchanged' when the merged bytes equal the existing file", () => {
      // Build `existing` to be exactly what insertManagedBlock would produce for
      // the same managedContent, so merged === existing → unchanged.
      const existing = `${START}\nsame body\n${END}\n`;
      const action = predictMergeAction(existing, "", "AGENTS.md", {
        managedContent: "same body",
      });
      expect(action).toBe("unchanged");
    });

    it("predicts 'updated' for an unchanged merge when skipIfUnchanged is false", () => {
      const existing = `${START}\nsame body\n${END}\n`;
      const action = predictMergeAction(existing, "", "AGENTS.md", {
        managedContent: "same body",
        skipIfUnchanged: false,
      });
      expect(action).toBe("updated");
    });

    it("predicts 'updated' AND logs a diagnostic when the block is corrupted (live path auto-repairs)", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Duplicate BEGIN markers → insertManagedBlock throws → predictor catches,
      // emits the Silent-Failure diagnostic, and predicts 'updated' (auto-repair).
      const corrupted = [START, "a", START, "dup", END].join("\n");

      const action = predictMergeAction(corrupted, "", "x.md", {
        managedContent: "new",
      });

      expect(action).toBe("updated");
      expect(errorSpy).toHaveBeenCalled();
      const msg = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(msg).toContain("corrupted/duplicate");
      expect(msg).toContain("x.md");
      expect(msg).toContain("auto-repairs");
    });
  });

  describe("no managedContent (whole-file replace path)", () => {
    it("predicts 'updated' for a hatch3r-managed filename when bytes differ", () => {
      expect(
        predictMergeAction("old", "new", "hatch3r-rule.md"),
      ).toBe("updated");
    });

    it("predicts 'unchanged' for a managed filename when bytes match", () => {
      expect(
        predictMergeAction("same", "same", "hatch3r-rule.md"),
      ).toBe("unchanged");
    });

    it("predicts 'updated' for a managed filename with matching bytes when skipIfUnchanged is false", () => {
      expect(
        predictMergeAction("same", "same", "hatch3r-rule.md", { skipIfUnchanged: false }),
      ).toBe("updated");
    });

    it("predicts 'updated' for a NN-hatch3r- prefixed filename", () => {
      expect(
        predictMergeAction("old", "new", ".cursor/rules/10-hatch3r-security.mdc"),
      ).toBe("updated");
    });

    it("predicts 'updated' when force is set on a NON-managed filename", () => {
      expect(
        predictMergeAction("old user", "forced", "custom.md", { force: true }),
      ).toBe("updated");
    });

    it("predicts 'unchanged' when force is set but bytes match", () => {
      expect(
        predictMergeAction("same", "same", "custom.md", { force: true }),
      ).toBe("unchanged");
    });

    it("predicts 'skipped' for a non-managed filename without force", () => {
      expect(predictMergeAction("user content", "new", "custom.md")).toBe("skipped");
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Frontmatter stub heal mirror (release/2.6.0, S1a): the live existing-markers
// branch replaces a heal-eligible prefix (empty / stale pure-frontmatter stub)
// with the freshly generated one, so the predictor must report "updated" for
// those inputs — predicting "unchanged" would re-open the preview-vs-reality
// gap this predictor closes.
// ───────────────────────────────────────────────────────────────────────────
describe("predictMergeAction stub heal mirror (release/2.6.0)", () => {
  const STUB = '---\nname: hatch3r-test\ndescription: "A test command."\n---\n\n';
  const BLOCK = `${START}\nbody line\n${END}\n`;

  it("predicts updated when the live write would heal an empty prefix", () => {
    expect(
      predictMergeAction(BLOCK, `${STUB}${BLOCK}`, "cmd.md", { managedContent: "body line" }),
    ).toBe("updated");
  });

  it("predicts updated when the live write would refresh a stale stub", () => {
    const stale = `---\nname: hatch3r-test\ndescription: "Old."\n---\n\n${BLOCK}`;
    expect(
      predictMergeAction(stale, `${STUB}${BLOCK}`, "cmd.md", { managedContent: "body line" }),
    ).toBe("updated");
  });

  it("predicts unchanged for a user-content prefix with an identical block", () => {
    const userFile = `# Mine\n\n${BLOCK}`;
    expect(
      predictMergeAction(userFile, `${STUB}${BLOCK}`, "cmd.md", { managedContent: "body line" }),
    ).toBe("unchanged");
  });

  it("predicts unchanged for an already-healed file", () => {
    const healed = `${STUB}${BLOCK}`;
    expect(
      predictMergeAction(healed, healed, "cmd.md", { managedContent: "body line" }),
    ).toBe("unchanged");
  });
});
