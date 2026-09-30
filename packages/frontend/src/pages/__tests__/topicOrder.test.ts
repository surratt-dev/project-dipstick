import { describe, it, expect } from "vitest";
import { moveUp, moveDown, moveToTop, moveToBottom, arraysEqual } from "../topicOrder.js";

// ---------------------------------------------------------------------------
// topicOrder — reorder-topics, tasks.md Task 6.1.
// ---------------------------------------------------------------------------

const LIST = ["a", "b", "c", "d"] as const;

describe("topicOrder move helpers", () => {
  it("moveUp swaps with the previous item", () => {
    expect(moveUp(LIST, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("moveDown swaps with the next item", () => {
    expect(moveDown(LIST, 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("moveToTop moves an item to index 0 and shifts the ones above it down", () => {
    expect(moveToTop(LIST, 3)).toEqual(["d", "a", "b", "c"]);
  });

  it("moveToBottom moves an item to the end and shifts the ones below it up", () => {
    expect(moveToBottom(LIST, 0)).toEqual(["b", "c", "d", "a"]);
  });

  it("is a no-op at the edges, returning the input itself", () => {
    expect(moveUp(LIST, 0)).toBe(LIST);
    expect(moveToTop(LIST, 0)).toBe(LIST);
    expect(moveDown(LIST, 3)).toBe(LIST);
    expect(moveToBottom(LIST, 3)).toBe(LIST);
  });

  it("is a no-op for an out-of-range index", () => {
    expect(moveUp(LIST, -1)).toBe(LIST);
    expect(moveDown(LIST, 9)).toBe(LIST);
  });

  it("never mutates its input", () => {
    const input = ["a", "b", "c"];
    const snapshot = [...input];
    moveUp(input, 1);
    moveDown(input, 1);
    moveToTop(input, 2);
    moveToBottom(input, 0);
    expect(input).toEqual(snapshot);
  });
});

describe("arraysEqual", () => {
  it("is true for the same values in the same order", () => {
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is false for a different order or length", () => {
    expect(arraysEqual(["a", "b"], ["b", "a"])).toBe(false);
    expect(arraysEqual(["a"], ["a", "b"])).toBe(false);
  });
});
