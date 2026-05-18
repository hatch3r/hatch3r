import { describe, expect, it } from "vitest";
import {
  HANDOFF_STATUSES,
  VALID_STATUS_TRANSITIONS,
  isHandoffStatus,
  isValidStatusTransition,
  type HandoffStatus,
} from "../../../content/handoffs/schema.js";

describe("handoffs/schema", () => {
  describe("HANDOFF_STATUSES", () => {
    it("contains all 7 lifecycle states", () => {
      expect([...HANDOFF_STATUSES]).toEqual([
        "open",
        "in-progress",
        "blocked",
        "handed-off",
        "resumed",
        "completed",
        "archived",
      ]);
    });
  });

  describe("VALID_STATUS_TRANSITIONS", () => {
    it("has an entry for every status", () => {
      for (const s of HANDOFF_STATUSES) {
        expect(VALID_STATUS_TRANSITIONS).toHaveProperty(s);
      }
    });

    it("only allows transitions to known HandoffStatus values", () => {
      const valid = new Set<HandoffStatus>(HANDOFF_STATUSES);
      for (const [, nexts] of Object.entries(VALID_STATUS_TRANSITIONS)) {
        for (const n of nexts) {
          expect(valid.has(n)).toBe(true);
        }
      }
    });

    it("makes archived a terminal state", () => {
      expect(VALID_STATUS_TRANSITIONS.archived).toEqual([]);
    });

    it("only allows completed -> archived", () => {
      expect(VALID_STATUS_TRANSITIONS.completed).toEqual(["archived"]);
    });
  });

  describe("isValidStatusTransition", () => {
    it.each<[HandoffStatus, HandoffStatus, boolean]>([
      ["open", "in-progress", true],
      ["open", "blocked", true],
      ["open", "handed-off", true],
      ["open", "archived", true],
      ["open", "completed", false],
      ["open", "resumed", false],
      ["in-progress", "completed", true],
      ["in-progress", "open", false],
      ["blocked", "in-progress", true],
      ["blocked", "completed", false],
      ["handed-off", "resumed", true],
      ["resumed", "in-progress", true],
      ["resumed", "completed", true],
      ["completed", "archived", true],
      ["completed", "resumed", false],
      ["archived", "open", false],
      ["archived", "archived", false],
    ])("from %s to %s -> %s", (from, to, expected) => {
      expect(isValidStatusTransition(from, to)).toBe(expected);
    });
  });

  describe("isHandoffStatus type guard", () => {
    it("accepts every valid status string", () => {
      for (const s of HANDOFF_STATUSES) {
        expect(isHandoffStatus(s)).toBe(true);
      }
    });

    it("rejects unknown strings", () => {
      expect(isHandoffStatus("done")).toBe(false);
      expect(isHandoffStatus("OPEN")).toBe(false);
      expect(isHandoffStatus("")).toBe(false);
    });

    it("rejects non-string values", () => {
      expect(isHandoffStatus(undefined)).toBe(false);
      expect(isHandoffStatus(null)).toBe(false);
      expect(isHandoffStatus(0)).toBe(false);
      expect(isHandoffStatus(["open"])).toBe(false);
      expect(isHandoffStatus({ status: "open" })).toBe(false);
    });
  });
});
