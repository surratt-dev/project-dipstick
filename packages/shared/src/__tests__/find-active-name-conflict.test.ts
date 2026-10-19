import { describe, it, expect } from "vitest";
import { findActiveNameConflict } from "../index.js";

const t = (id: string, name: string, displayOrder: number) => ({ id, name, displayOrder });

describe("findActiveNameConflict", () => {
  it("returns null when nothing matches or the list is empty", () => {
    expect(findActiveNameConflict([], "Safety")).toBeNull();
    expect(findActiveNameConflict([t("a", "Other", 1)], "Safety")).toBeNull();
  });

  it("returns the stored name, not the candidate", () => {
    expect(findActiveNameConflict([t("a", "Safety", 1)], " safety ")).toEqual({ id: "a", name: "Safety" });
  });

  it("picks the lowest displayOrder, then the lowest id", () => {
    const list = [t("c", "Dup", 3), t("b", "dup", 2), t("a", "DUP", 2)];
    expect(findActiveNameConflict(list, "dup")).toEqual({ id: "a", name: "DUP" });
    expect(findActiveNameConflict([...list].reverse(), "dup")).toEqual({ id: "a", name: "DUP" });
  });

  it("treats blank names as equal to each other (legacy rows)", () => {
    expect(findActiveNameConflict([t("a", "  ", 1)], "")).toEqual({ id: "a", name: "  " });
  });
});
