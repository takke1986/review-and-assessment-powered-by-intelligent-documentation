import {
  REVIEW_RESULT_STATUS,
  ReviewResultDetail,
} from "../../api/features/review/domain/model/review";
import { leafResults } from "../../api/features/review/domain/service/check-item-selection";

/**
 * ジョブの結果から、審査する項目を選ぶ。
 *
 * - 子を持つ親項目は、子の結果から判定するので審査しない
 * - 完了済みの結果は審査しない。再審査のジョブでは、元のジョブから
 *   引き継いだ結果が完了済みの状態で作られている
 */
export const selectItemsToReview = (
  results: ReviewResultDetail[]
): Array<{ checkId: string; reviewResultId: string }> => {
  return leafResults(results)
    .filter((result) => result.status !== REVIEW_RESULT_STATUS.COMPLETED)
    .map((result) => ({
      checkId: result.checkList.id,
      reviewResultId: result.id,
    }));
};
