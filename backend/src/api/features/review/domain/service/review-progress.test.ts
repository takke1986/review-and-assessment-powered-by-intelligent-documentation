import { describe, it, expect } from "vitest";
import { countReviewProgress } from "./review-progress";

// A ─┬─ A1
//    └─ A2
// B ─── B1 ─── B1a
// C
const result = (checkId: string, status: string, parentId?: string) => ({
  checkId,
  status,
  parentId: parentId ?? null,
});

describe("countReviewProgress", () => {
  it("counts only items without children", () => {
    expect(
      countReviewProgress([
        result("A", "pending"),
        result("A1", "pending", "A"),
        result("A2", "pending", "A"),
        result("B", "pending"),
        result("B1", "pending", "B"),
        result("B1a", "pending", "B1"),
        result("C", "pending"),
      ])
    ).toEqual({ completed: 0, total: 4 });
  });

  it("counts completed items and leaves pending and processing ones out", () => {
    expect(
      countReviewProgress([
        result("A", "pending"),
        result("A1", "completed", "A"),
        result("A2", "processing", "A"),
        result("C", "completed"),
      ])
    ).toEqual({ completed: 2, total: 3 });
  });

  it("does not count a completed parent", () => {
    expect(
      countReviewProgress([
        result("A", "completed"),
        result("A1", "completed", "A"),
        result("A2", "pending", "A"),
      ])
    ).toEqual({ completed: 1, total: 2 });
  });

  it("returns zero for a job without results", () => {
    expect(countReviewProgress([])).toEqual({ completed: 0, total: 0 });
  });
});
