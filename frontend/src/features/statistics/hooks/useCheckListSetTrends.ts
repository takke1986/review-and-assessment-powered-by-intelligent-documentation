import { useApiClient } from "../../../hooks/useApiClient";
import { GetCheckListSetTrendsResponse } from "../types";

export function useCheckListSetTrends(params: {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  search: string;
  includeUnreviewed: boolean;
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  // 空文字を送るとサーバ側で「絞り込みあり」と扱われうるので、値があるときだけ付ける
  if (params.search.trim()) {
    query.set("search", params.search.trim());
  }
  if (params.includeUnreviewed) {
    query.set("includeUnreviewed", "true");
  }

  const { data, isLoading, error, refetch } =
    useApiClient().useQuery<GetCheckListSetTrendsResponse>(
      `/checklist-set-trends?${query.toString()}`
    );

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 1,
    isLoading,
    error,
    refetch,
  };
}
