import { useApiClient } from "../../../hooks/useApiClient";
import type {
  GetAllChecklistSetsResponse,
  GetChecklistSetResponse,
  GetChecklistItemsResponse,
  CheckListItemDetail,
  CheckListSetDetailModel,
  CHECK_LIST_STATUS,
} from "../types";

export const getChecklistSetsKey = (
  page?: number,
  limit?: number,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  status?: CHECK_LIST_STATUS,
  search?: string
) => {
  const params = new URLSearchParams();
  if (page) params.append("page", page.toString());
  if (limit) params.append("limit", limit.toString());
  if (sortBy) params.append("sortBy", sortBy);
  if (sortOrder) params.append("sortOrder", sortOrder);
  if (status) params.append("status", status);
  // 絞り込みはサーバ側で行う。画面側で絞ると、そのページの分しか対象にならない
  if (search?.trim()) params.append("search", search.trim());
  return `/checklist-sets?${params.toString()}`;
};

export const getChecklistSetKey = (setId: string | null) =>
  setId ? `/checklist-sets/${setId}` : null;

export const getChecklistItemsKey = (setId: string | null) =>
  setId ? `/checklist-sets/${setId}/items` : null;

export function useChecklistSets(
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  status?: CHECK_LIST_STATUS,
  search?: string
) {
  const url = getChecklistSetsKey(
    page,
    limit,
    sortBy,
    sortOrder,
    status,
    search
  );
  const { data, isLoading, error, refetch } =
    useApiClient().useQuery<GetAllChecklistSetsResponse>(url);

  return {
    items: data
      ? data.checkListSets.map(({ checkListSetId, ...rest }) => ({
          id: checkListSetId,
          ...rest,
        }))
      : [],
    total: data?.total ?? 0,
    // 取得前は items が空配列になるので、「0件」と「まだ届いていない」を区別する
    isLoaded: data !== undefined,
    page: data?.page ?? page,
    limit: data?.limit ?? limit,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    refetch,
  };
}

/**
 * チェックリストセットの詳細情報を取得するカスタムフック
 */
export function useChecklistSetDetail(setId: string | null) {
  const url = getChecklistSetKey(setId);
  const { data, isLoading, error, refetch } =
    useApiClient().useQuery<GetChecklistSetResponse>(url);

  return {
    checklistSet: data || null,
    isLoading,
    error,
    refetch,
  };
}
