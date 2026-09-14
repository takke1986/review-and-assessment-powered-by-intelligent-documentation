import { REVIEW_RESULT_STATUS, ReviewJobProgress } from "../model/review";

/**
 * ジョブの結果から、審査の進み具合を数える。
 *
 * 数えるのは子を持たない項目だけ。親の項目は子の結果から判定をまとめるだけで、
 * それ自体は審査しない。項目ごとの結果は、その項目の審査が終わると completed になる。
 */
export const countReviewProgress = (
  results: Array<{
    checkId: string;
    status: string;
    parentId?: string | null;
  }>
): ReviewJobProgress => {
  const parentIds = new Set(
    results
      .map((result) => result.parentId)
      .filter((parentId): parentId is string => !!parentId)
  );
  const leaves = results.filter((result) => !parentIds.has(result.checkId));
  return {
    completed: leaves.filter(
      (result) => result.status === REVIEW_RESULT_STATUS.COMPLETED
    ).length,
    total: leaves.length,
  };
};
