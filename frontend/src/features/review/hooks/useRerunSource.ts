import { useMemo } from "react";
import { REVIEW_RESULT, REVIEW_RESULT_STATUS } from "../types";
import { useReviewJobDetail } from "./useReviewJobQueries";
import { useAllReviewResults } from "./useReviewResultQueries";

/**
 * 再審査の元になる審査ジョブを読み込む。sourceJobId が null なら通常の審査で、
 * 何も読み込まない。
 *
 * failedCheckIds は、再審査で最初に選んでおく項目。元のジョブで不合格だった
 * 子項目と、審査が完了しなかった子項目で、バックエンドの既定と同じ規則。
 * 結果を読み込むまでは undefined。
 */
export function useRerunSource(sourceJobId: string | null) {
  const { job: sourceJob } = useReviewJobDetail(sourceJobId);
  const { items: sourceResults, isLoading: isLoadingSourceResults } =
    useAllReviewResults(sourceJobId);

  const failedCheckIds = useMemo(() => {
    if (!sourceJobId || isLoadingSourceResults) {
      return undefined;
    }
    const parentIds = new Set(
      sourceResults.map((result) => result.checkList.parentId)
    );
    return sourceResults
      .filter((result) => !parentIds.has(result.checkId))
      .filter(
        (result) =>
          result.status !== REVIEW_RESULT_STATUS.COMPLETED ||
          result.result === REVIEW_RESULT.FAIL
      )
      .map((result) => result.checkId);
  }, [sourceJobId, isLoadingSourceResults, sourceResults]);

  const failedCheckIdSet = useMemo(
    () => new Set(failedCheckIds ?? []),
    [failedCheckIds]
  );

  return { sourceJob, failedCheckIds, failedCheckIdSet };
}
