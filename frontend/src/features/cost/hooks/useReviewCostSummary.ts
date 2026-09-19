import { useApiClient } from "../../../hooks/useApiClient";
import type { GetReviewCostSummaryResponse } from "../types";

/**
 * 費用の内訳を取る。
 *
 * 月の切れ目は利用者の暦に合わせたいので、時間帯をサーバに渡す。
 * 渡さないと日本では毎月1日の朝9時までが前の月に数えられる
 */
export function useReviewCostSummary(createdFrom?: Date) {
  const params = new URLSearchParams({
    tzOffsetMinutes: String(new Date().getTimezoneOffset()),
  });
  if (createdFrom) {
    params.append("createdFrom", createdFrom.toISOString());
  }
  const { data, isLoading, error, refetch } =
    useApiClient().useQuery<GetReviewCostSummaryResponse>(
      `/review-jobs/cost-summary?${params.toString()}`
    );

  return { summary: data, isLoading, error, refetch };
}
