import { useState } from "react";
import { useTranslation } from "react-i18next";
import useHttp from "../../../hooks/useHttp";
import { useToast } from "../../../contexts/ToastContext";

/**
 * 審査ジョブへの操作。中止と、続きから流すこと。
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

  /**
   * 途中で終わった審査を、そのジョブのまま続きから流す。
   *
   * 別のジョブを作らないので、履歴が増えない。判定の済んだ項目は
   * そのまま残り、まだ判定していない項目だけが審査される
   */
  const resume = async () => {
    setIsWorking(true);
    try {
      await http.post(`/review-jobs/${jobId}/resume`, {});
      addToast(t("review.resumed"), "success");
      onChanged();
    } catch (error) {
      console.error(error);
      addToast(t("review.resumeError"), "error");
    } finally {
      setIsWorking(false);
    }
  };

  return { isWorking, cancel, resume };
}
