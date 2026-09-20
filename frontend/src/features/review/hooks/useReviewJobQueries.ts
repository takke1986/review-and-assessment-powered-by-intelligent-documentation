import { useApiClient } from "../../../hooks/useApiClient";
import type {
  GetAllReviewJobsResponse,
  ReviewJobDetail,
  GetReviewJobDetailResponse,
} from "../types";
import { isJobRunning } from "../types";

/** 実行中のジョブを読み直す間隔 */
export const RUNNING_JOB_REFRESH_INTERVAL_MS = 5000;

/**
 * 審査ジョブ一覧のキャッシュキーを生成する関数
 */
export const getReviewJobsKey = (
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  status?: string,
  search?: string,
  checkListSetId?: string
) => {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  if (sortBy) params.append("sortBy", sortBy);
  if (sortOrder) params.append("sortOrder", sortOrder);
  if (status) params.append("status", status);
  // 絞り込みはサーバ側で行う。画面側で絞ると、そのページの分しか対象にならない
  if (search?.trim()) params.append("search", search.trim());
  // 費用の内訳から「この審査が高い」で飛んできたときに使う
  if (checkListSetId) params.append("checkListSetId", checkListSetId);
  return `/review-jobs?${params.toString()}`;
};

/**
 * 審査ジョブ詳細のキャッシュキーを生成する関数
 */
export const getReviewJobDetailKey = (jobId: string | null) =>
  jobId ? `/review-jobs/${jobId}` : null;

/**
 * 審査ジョブ一覧を取得するカスタムフック
 */
export function useReviewJobs(
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  status?: string,
  search?: string,
  checkListSetId?: string
) {
  const url = getReviewJobsKey(
    page,
    limit,
    sortBy,
    sortOrder,
    status,
    search,
    checkListSetId
  );
  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useApiClient().useQuery<GetAllReviewJobsResponse>(url, {
    // 実行中のジョブがあるあいだは数秒ごとに読み直して、状態と進み具合を更新する
    refreshInterval: (latest) =>
      latest?.success &&
      latest.data?.items?.some((job) => isJobRunning(job.status))
        ? RUNNING_JOB_REFRESH_INTERVAL_MS
        : 0,
  });

  return {
    items: result?.items ?? [],
    total: result?.total ?? 0,
    page: result?.page ?? page,
    limit: result?.limit ?? limit,
    totalPages: result?.totalPages ?? 0,
    isLoading,
    error,
    refetch,
  };
}

/**
 * 審査ジョブ詳細を取得するカスタムフック
 */
export function useReviewJobDetail(jobId: string | null) {
  const url = getReviewJobDetailKey(jobId);
  const { data, isLoading, error, refetch } =
    useApiClient().useQuery<GetReviewJobDetailResponse>(url, {
      // 実行中は数秒ごとに読み直して、状態と進み具合を更新する
      refreshInterval: (latest) =>
        latest?.success && latest.data && isJobRunning(latest.data.status)
          ? RUNNING_JOB_REFRESH_INTERVAL_MS
          : 0,
    });

  return {
    job: data as ReviewJobDetail | null,
    isLoading,
    error,
    refetch,
  };
}
