import { describe, it, expect } from "vitest";
import { selectItemsToReview } from "../review-processing/select-items";
import {
  REVIEW_RESULT_STATUS,
  ReviewResultDetail,
} from "../../api/features/review/domain/model/review";

const result = (
  checkId: string,
  status: REVIEW_RESULT_STATUS,
  parentId?: string
): ReviewResultDetail => ({
  id: `result-${checkId}`,
  reviewJobId: "job-1",
  checkId,
  status,
  userOverride: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  checkList: { id: checkId, setId: "set-1", name: checkId, parentId },
  hasChildren: false,
});

describe("selectItemsToReview", () => {
  it("reviews every leaf item of a new job", () => {
    const items = selectItemsToReview([
      result("A", REVIEW_RESULT_STATUS.PENDING),
      result("A1", REVIEW_RESULT_STATUS.PENDING, "A"),
      result("A2", REVIEW_RESULT_STATUS.PENDING, "A"),
      result("B", REVIEW_RESULT_STATUS.PENDING),
    ]);

    expect(items).toEqual([
      { checkId: "A1", reviewResultId: "result-A1" },
      { checkId: "A2", reviewResultId: "result-A2" },
      { checkId: "B", reviewResultId: "result-B" },
    ]);
  });

  it("skips results that are already completed, such as carried-over ones", () => {
    const items = selectItemsToReview([
      result("A", REVIEW_RESULT_STATUS.PENDING),
      result("A1", REVIEW_RESULT_STATUS.COMPLETED, "A"),
      result("A2", REVIEW_RESULT_STATUS.PENDING, "A"),
      result("B", REVIEW_RESULT_STATUS.COMPLETED),
    ]);

    expect(items.map((item) => item.checkId)).toEqual(["A2"]);
  });

  it("reviews failed and in-progress leaves again", () => {
    const items = selectItemsToReview([
      result("A", REVIEW_RESULT_STATUS.FAILED),
      result("B", REVIEW_RESULT_STATUS.PROCESSING),
    ]);

    expect(items.map((item) => item.checkId)).toEqual(["A", "B"]);
  });
});
