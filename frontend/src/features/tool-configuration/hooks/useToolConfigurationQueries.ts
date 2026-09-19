import { useApiClient } from "../../../hooks/useApiClient";
import { ApiResponse } from "../../../types/api";
import { ToolConfiguration } from "../types";

/**
 * ツール設定の一覧。
 *
 * 一覧画面はページで区切って見るが、チェックリスト項目に割り当てるモーダルは
 * 全部から選ぶ必要がある。呼ぶ側が limit を決められるようにしてある。
 */
export const useToolConfigurations = (params?: {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}) => {
  const query = new URLSearchParams();
  if (params?.page) query.append("page", String(params.page));
  if (params?.limit) query.append("limit", String(params.limit));
  if (params?.sortBy) query.append("sortBy", params.sortBy);
  if (params?.sortOrder) query.append("sortOrder", params.sortOrder);
  // 絞り込みはサーバ側で行う。画面側で絞ると、そのページの分しか対象にならない
  if (params?.search?.trim()) query.append("search", params.search.trim());

  const { data, isLoading, error, refetch } = useApiClient().useQuery<
    ApiResponse<{
      items: ToolConfiguration[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>
  >(`/tool-configurations?${query.toString()}`);

  return {
    toolConfigurations: data?.items ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? params?.page ?? 1,
    limit: data?.limit ?? params?.limit ?? 10,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    refetch,
  };
};

export const useToolConfiguration = (id: string) => {
  const { data, isLoading, error, refetch } = useApiClient().useQuery<
    ApiResponse<ToolConfiguration>
  >(`/tool-configurations/${id}`);

  console.log("[useToolConfiguration] Raw response:", {
    data,
    isLoading,
    error,
    id,
  });

  return {
    toolConfiguration: data,
    isLoading,
    error,
    refetch,
  };
};
