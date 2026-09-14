import { describe, it, expect } from "vitest";
import { countCheckItems } from "./check-item-selection";

// A ─┬─ A1
//    └─ A2
// B ─── B1 ─── B1a
// C
const items = [
  { id: "A", parentId: null },
  { id: "A1", parentId: "A" },
  { id: "A2", parentId: "A" },
  { id: "B", parentId: null },
  { id: "B1", parentId: "B" },
  { id: "B1a", parentId: "B1" },
  { id: "C", parentId: null },
];

describe("countCheckItems", () => {
  it("counts only items without children", () => {
    expect(
      countCheckItems(items, ["A", "A1", "A2", "B", "B1", "B1a", "C"])
    ).toEqual({ reviewed: 4, total: 4 });
  });

  it("counts the items a partial job reviewed, not their ancestors", () => {
    expect(countCheckItems(items, ["A", "A1"])).toEqual({
      reviewed: 1,
      total: 4,
    });
  });

  it("ignores results for items that are not in the checklist", () => {
    expect(countCheckItems(items, ["A1", "X"])).toEqual({
      reviewed: 1,
      total: 4,
    });
  });

  it("counts an item once even if it appears more than once", () => {
    expect(countCheckItems(items, ["C", "C"])).toEqual({
      reviewed: 1,
      total: 4,
    });
  });

  it("returns zero for a checklist without items", () => {
    expect(countCheckItems([], [])).toEqual({ reviewed: 0, total: 0 });
  });
});
