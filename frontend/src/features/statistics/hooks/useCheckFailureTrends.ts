import { useApiClient } from "../../../hooks/useApiClient";
import { GetCheckFailureTrendsResponse } from "../types";

export function useCheckFailureTrends(setId: string | null) {
  const { data, isLoading, error, refetch } =
    useApiClient().useQuery<GetCheckFailureTrendsResponse>(
      setId ? `/checklist-sets/${setId}/check-failure-trends` : null
    );

  return {
    items: data?.items ?? [],
    reviewJobCount: data?.reviewJobCount ?? 0,
    isLoading,
    error,
    refetch,
  };
}
