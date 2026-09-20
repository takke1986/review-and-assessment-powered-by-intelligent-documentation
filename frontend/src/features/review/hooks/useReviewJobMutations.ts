import { mutate } from "swr";
import { useApiClient } from "../../../hooks/useApiClient";
import type {
  CreateReviewJobRequest,
  CreateReviewJobResponse,
  DeleteReviewJobResponse,
} from "../types";

/**
 * 審査ジョブを作成するカスタムフック
 */
export function useCreateReviewJob() {
  const { mutateAsync, status, error } = useApiClient().useMutation<
    CreateReviewJobResponse,
    CreateReviewJobRequest
  >("post", "/review-jobs");

  const createReviewJob = async (body: CreateReviewJobRequest) => {
    const res = await mutateAsync(body);
    // キャッシュ更新
    mutate((key) => typeof key === "string" && key.startsWith("/review-jobs"));
    return res;
  };

  return { createReviewJob, status, error };
}

/**
 * 審査ジョブを削除するカスタムフック
 */
export function useDeleteReviewJob() {
  const { mutateAsync, status, error } = useApiClient().useMutation<
    DeleteReviewJobResponse,
    void
  >("delete", "/review-jobs");

  const deleteReviewJob = async (jobId: string) => {
    const res = await mutateAsync(undefined, `/review-jobs/${jobId}`);
    // キャッシュ更新
    mutate((key) => typeof key === "string" && key.startsWith("/review-jobs"));
    return res;
  };

  return { deleteReviewJob, status, error };
}
