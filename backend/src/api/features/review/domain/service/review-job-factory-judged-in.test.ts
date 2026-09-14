import { describe, it, expect } from "vitest";
import { createRerunResults } from "./review-rerun";
import {
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  ReviewResultDetail,
  ReviewResultDomain,
} from "../model/review";

const items = [{ id: "A" }, { id: "B" }, { id: "C" }];

const previous = (
  checkId: string,
  result: REVIEW_RESULT,
  extra: Partial<ReviewResultDetail> = {}
): ReviewResultDetail => ({
  id: `prev-${checkId}`,
  reviewJobId: "job-2",
  checkId,
  status: REVIEW_RESULT_STATUS.COMPLETED,
  result,
  userOverride: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  checkList: { id: checkId, setId: "set-1", name: checkId },
  hasChildren: false,
  ...extra,
});

describe("createRerunResults: the job that produced a result", () => {
  // job-2 reviewed A itself, carried B over from job-1, and failed C.
  const sourceResults = [
    previous("A", REVIEW_RESULT.PASS),
    previous("B", REVIEW_RESULT.PASS, {
      carriedOver: true,
      judgedInReviewJobId: "job-1",
    }),
    previous("C", REVIEW_RESULT.FAIL),
  ];
  const results = new Map(
    createRerunResults("job-3", items, sourceResults).map((r) => [r.checkId, r])
  );

  it("points a result carried over from a reviewed one at the source job", () => {
    expect(results.get("A")!.judgedInReviewJobId).toBe("job-2");
  });

  it("keeps pointing at the first job across repeated carry-overs", () => {
    expect(results.get("B")!.judgedInReviewJobId).toBe("job-1");
  });

  it("leaves it unset for a result reviewed again in this job", () => {
    expect(results.get("C")!.status).toBe(REVIEW_RESULT_STATUS.PENDING);
    expect(results.get("C")!.judgedInReviewJobId).toBeUndefined();
  });
});

describe("ReviewResultDomain.fromPrismaReviewResult", () => {
  const row = (judgedInReviewJobId: string | null) => ({
    id: "result-1",
    reviewJobId: "job-3",
    checkId: "B",
    status: "completed",
    result: "pass",
    userOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    carriedOver: true,
    previousResultId: "prev-B",
    judgedInReviewJobId,
  });

  it("maps the job that produced the result", () => {
    expect(
      ReviewResultDomain.fromPrismaReviewResult(row("job-1"))
        .judgedInReviewJobId
    ).toBe("job-1");
  });

  it("turns a missing job into undefined", () => {
    expect(
      ReviewResultDomain.fromPrismaReviewResult(row(null)).judgedInReviewJobId
    ).toBeUndefined();
  });
});
