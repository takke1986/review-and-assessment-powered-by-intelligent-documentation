import { useState } from "react";
import { useTranslation } from "react-i18next";
import useHttp from "../../../hooks/useHttp";
import { useToast } from "../../../contexts/ToastContext";

/**
 * 審査ジョブへの操作。いまは中止だけ。
 *
 * 作成者だけができる。結果は呼び出し元で読み直す。
 *
 * 社内への公開もここにあったが、画面から外したので消した。API と列は
 * 残してあるので、要るようになったら戻せる
 */
export function useReviewJobActions(jobId: string, onChanged: () => void) {
  const { t } = useTranslation();
  const http = useHttp();
  const { addToast } = useToast();
  const [isWorking, setIsWorking] = useState(false);

  const cancel = async () => {
    setIsWorking(true);
    try {
      await http.post(`/review-jobs/${jobId}/cancel`, {});
      addToast(t("review.cancelled"), "success");
      onChanged();
    } catch (error) {
      console.error(error);
      addToast(t("review.cancelError"), "error");
    } finally {
      setIsWorking(false);
    }
  };

  return { isWorking, cancel };
}
