import { ulid } from "ulid";
import { REVIEW_RESULT_STATUS, ReviewResultEntity } from "../model/review";

/**
 * 審査待ちの結果を作る。通常の審査と再審査の両方で使う。
 */
export const createInitialReviewResult = (
  reviewJobId: string,
  checkId: string
): ReviewResultEntity => {
  return {
    id: ulid(),
    reviewJobId,
    checkId,
    status: REVIEW_RESULT_STATUS.PENDING,
    userOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};
