import { useApiClient } from "../../../hooks/useApiClient";
import type {
  ReviewJobSummary,
  GetAllReviewJobsResponse,
  ReviewJobDetail,
  GetReviewJobDetailResponse,
} from "../types";
import { REVIEW_JOB_STATUS } from "../types";

/** 実行中のジョブを読み直す間隔 */
export const RUNNING_JOB_REFRESH_INTERVAL_MS = 5000;

/** 審査が終わっていない（待機中か処理中の）ジョブか */
export const isJobRunning = (status: REVIEW_JOB_STATUS) =>
  status === REVIEW_JOB_STATUS.PENDING ||
  status === REVIEW_JOB_STATUS.PROCESSING;

/**
 * 審査ジョブ一覧のキャッシュキーを生成する関数
 */
export const getReviewJobsKey = (
  page = 1,
  limit = 10,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  status?: string
) => {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  if (sortBy) params.append("sortBy", sortBy);
  if (sortOrder) params.append("sortOrder", sortOrder);
  if (status) params.append("status", status);
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
  status?: string
) {
  const url = getReviewJobsKey(page, limit, sortBy, sortOrder, status);
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
