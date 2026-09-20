import { useState } from "react";
import { useTranslation } from "react-i18next";
import useHttp from "../../../hooks/useHttp";
import { useToast } from "../../../contexts/ToastContext";

/**
 * 審査ジョブへの操作。中止と、社内への公開。
 *
 * どちらも作成者だけができる。結果は呼び出し元で読み直す
 */
export function useReviewJobActions(jobId: string, onChanged: () => void) {
  const { t } = useTranslation();
  const http = useHttp();
  const { addToast } = useToast();
  const [isWorking, setIsWorking] = useState(false);

  const run = async (
    action: () => Promise<unknown>,
    successKey: string,
    errorKey: string
  ) => {
    setIsWorking(true);
    try {
      await action();
      addToast(t(successKey), "success");
      onChanged();
    } catch (error) {
      console.error(error);
      addToast(t(errorKey), "error");
    } finally {
      setIsWorking(false);
    }
  };

  return {
    isWorking,
    cancel: () =>
      run(
        () => http.post(`/review-jobs/${jobId}/cancel`, {}),
        "review.cancelled",
        "review.cancelError"
      ),
    setSharing: (sharedWithOrg: boolean) =>
      run(
        () => http.put(`/review-jobs/${jobId}/sharing`, { sharedWithOrg }),
        sharedWithOrg ? "review.shared" : "review.shareWithOrg",
        "review.shareError"
      ),
  };
}
