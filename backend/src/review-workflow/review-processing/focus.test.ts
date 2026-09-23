import { describe, it, expect } from "vitest";
import { focusFor, MAX_FOCUS_ITEMS, MAX_FOCUS_LENGTH } from "./focus";

const item = (checkId: string, name: string, parentId?: string): any => ({
  id: `result-${checkId}`,
  checkId,
  checkList: { id: checkId, name, parentId },
});

describe("focusFor", () => {
  it("lists what the documents will be checked against", () => {
    expect(
      focusFor([item("A", "押印の有無"), item("B", "金額の一致")])
    ).toEqual(["押印の有無", "金額の一致"]);
  });

  // 親は子から集計して決まる。審査するのは子を持たない項目だけ
  it("leaves out a parent that is not reviewed on its own", () => {
    const results = [
      item("A", "書類一式"),
      item("A1", "押印の有無", "A"),
      item("A2", "金額の一致", "A"),
    ];
    expect(focusFor(results)).toEqual(["押印の有無", "金額の一致"]);
  });

  it("keeps the order the items are reviewed in", () => {
    const results = [
      item("A", "一つ目"),
      item("B", "二つ目"),
      item("C", "三つ目"),
    ];
    expect(focusFor(results)).toEqual(["一つ目", "二つ目", "三つ目"]);
  });

  it("ignores an item with no name", () => {
    expect(focusFor([item("A", "  "), item("B", "名前あり")])).toEqual([
      "名前あり",
    ]);
  });

  // 項目が数百あると読み取りの指示が膨らみ、読み取り自体の費用が増える
  it("stops after enough points to be useful", () => {
    const many = Array.from({ length: MAX_FOCUS_ITEMS + 10 }, (_, n) =>
      item(`C${n}`, `項目${n}`)
    );
    expect(focusFor(many)).toHaveLength(MAX_FOCUS_ITEMS);
  });

  it("shortens a point that runs long", () => {
    const long = "あ".repeat(MAX_FOCUS_LENGTH + 20);
    const [only] = focusFor([item("A", long)]);
    expect(only).toHaveLength(MAX_FOCUS_LENGTH + 1);
    expect(only.endsWith("…")).toBe(true);
  });

  it("says nothing for a job with no items", () => {
    expect(focusFor([])).toEqual([]);
  });
});
