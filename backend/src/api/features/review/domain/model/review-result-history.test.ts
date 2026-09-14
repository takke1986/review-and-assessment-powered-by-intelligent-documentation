import { describe, it, expect } from "vitest";
import {
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  ReviewResultDomain,
} from "./review";

// The shape Prisma returns for a result with its check item and the
// previous result selected through ReviewResultDomain.previousResultSelect.
const prismaResult = (previousResult: unknown) => ({
  id: "result-2",
  reviewJobId: "rerun-job",
  checkId: "A1",
  status: "completed",
  result: "pass",
  confidenceScore: 0.95,
  explanation: "fixed in the revised document",
  shortExplanation: "fixed",
  extractedText: null,
  userOverride: false,
  userComment: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  reviewMeta: null,
  inputTokens: 3,
  outputTokens: 300,
  totalCost: 0.0045,
  sourceReferences: null,
  externalSources: null,
  previousResultId: "result-1",
  carriedOver: false,
  checkList: {
    id: "A1",
    checkListSetId: "set-1",
    name: "A1",
    description: null,
    parentId: "A",
  },
  previousResult,
});

describe("ReviewResultDomain.fromPrismaReviewResultDetail", () => {
  it("maps the link to the previous result and its summary", () => {
    const detail = ReviewResultDomain.fromPrismaReviewResultDetail(
      prismaResult({
        id: "result-1",
        reviewJobId: "source-job",
        status: "completed",
        result: "fail",
        confidenceScore: 0.8,
        explanation: "the approver is missing",
        shortExplanation: "no approver",
        userOverride: true,
        userComment: "confirmed by hand",
      }),
      false
    );

    expect(detail.previousResultId).toBe("result-1");
    expect(detail.carriedOver).toBe(false);
    expect(detail.previousResult).toEqual({
      id: "result-1",
      reviewJobId: "source-job",
      status: REVIEW_RESULT_STATUS.COMPLETED,
      result: REVIEW_RESULT.FAIL,
      confidenceScore: 0.8,
      explanation: "the approver is missing",
      shortExplanation: "no approver",
      userOverride: true,
      userComment: "confirmed by hand",
    });
  });

  it("leaves previousResult out when there is none", () => {
    const detail = ReviewResultDomain.fromPrismaReviewResultDetail(
      { ...prismaResult(null), previousResultId: null },
      false
    );

    expect(detail.previousResultId).toBeUndefined();
    expect(detail.previousResult).toBeUndefined();
  });

  it("turns nullable columns of the previous result into undefined", () => {
    const detail = ReviewResultDomain.fromPrismaReviewResultDetail(
      prismaResult({
        id: "result-1",
        reviewJobId: "source-job",
        status: "failed",
        result: null,
        confidenceScore: null,
        explanation: null,
        shortExplanation: null,
        userOverride: false,
        userComment: null,
      }),
      false
    );

    expect(detail.previousResult).toEqual({
      id: "result-1",
      reviewJobId: "source-job",
      status: REVIEW_RESULT_STATUS.FAILED,
      result: undefined,
      confidenceScore: undefined,
      explanation: undefined,
      shortExplanation: undefined,
      userOverride: false,
      userComment: undefined,
    });
  });
});
