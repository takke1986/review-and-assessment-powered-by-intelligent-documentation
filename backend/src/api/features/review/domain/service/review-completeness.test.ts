import { describe, it, expect } from "vitest";
import { unjudgedLeaves, describeUnjudged } from "./review-completeness";
import { REVIEW_RESULT_STATUS } from "../model/review";

// A ─┬─ A1
//    └─ A2
// B
const result = (
  checkId: string,
  status: REVIEW_RESULT_STATUS,
  parentId?: string
): any => ({
  id: `result-${checkId}`,
  checkId,
  status,
  checkList: { id: checkId, name: `項目${checkId}`, parentId },
});

const { COMPLETED, PENDING, PROCESSING, FAILED } = REVIEW_RESULT_STATUS;

describe("unjudgedLeaves", () => {
  it("finds nothing when every leaf has a verdict", () => {
    const results = [
      result("A", COMPLETED),
      result("A1", COMPLETED, "A"),
      result("A2", COMPLETED, "A"),
      result("B", COMPLETED),
    ];
    expect(unjudgedLeaves(results)).toEqual([]);
  });

  it("finds the leaf that was never judged", () => {
    const results = [
      result("A", COMPLETED),
      result("A1", COMPLETED, "A"),
      result("A2", PENDING, "A"),
      result("B", COMPLETED),
    ];
    expect(unjudgedLeaves(results).map((r) => r.checkId)).toEqual(["A2"]);
  });

  it("finds a leaf still being processed", () => {
    const results = [result("B", PROCESSING)];
    expect(unjudgedLeaves(results).map((r) => r.checkId)).toEqual(["B"]);
  });

  it("finds a leaf whose review failed", () => {
    const results = [result("B", FAILED)];
    expect(unjudgedLeaves(results).map((r) => r.checkId)).toEqual(["B"]);
  });

  // 親の判定は子から集計して決まるので、親そのものを審査することはない。
  // 親を数えると、判定の付きようがない項目を待ち続けて完了できなくなる
  it("ignores a parent that has no verdict of its own", () => {
    const results = [
      result("A", PENDING),
      result("A1", COMPLETED, "A"),
      result("A2", COMPLETED, "A"),
    ];
    expect(unjudgedLeaves(results)).toEqual([]);
  });

  // 一部の項目だけを選んで審査したジョブでは、選ばなかった項目の結果が
  // そもそも作られない。「チェックリスト全部が揃っているか」ではなく
  // 「このジョブにある項目が判定されたか」を見る
  it("accepts a job that was created for only some of the check items", () => {
    const results = [result("A", COMPLETED), result("A1", COMPLETED, "A")];
    expect(unjudgedLeaves(results)).toEqual([]);
  });

  // 再審査では、元のジョブから引き継いだ結果が完了済みで作られる。
  // 引き継ぎを「判定されていない」と数えると、再審査が必ず失敗する
  it("accepts results carried over from the job being re-reviewed", () => {
    const results = [
      result("A", COMPLETED),
      result("A1", COMPLETED, "A"), // 引き継ぎ
      result("A2", COMPLETED, "A"), // 今回審査した
    ];
    expect(unjudgedLeaves(results)).toEqual([]);
  });
});

describe("describeUnjudged", () => {
  it("says nothing when the review is complete", () => {
    expect(describeUnjudged([result("B", COMPLETED)])).toBe("");
  });

  it("names the items and their state, so the failure can be read", () => {
    const results = [
      result("A", COMPLETED),
      result("A1", PENDING, "A"),
      result("A2", FAILED, "A"),
    ];
    expect(describeUnjudged(results)).toBe("項目A1(pending), 項目A2(failed)");
  });
});
