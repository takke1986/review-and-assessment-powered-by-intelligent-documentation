import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../contexts/ToastContext";
import { isJobRunning, REVIEW_JOB_STATUS } from "../types";

/** 知らせを出しておく時間 */
const NOTICE_DURATION_MS = 15000;

/** 知らせるのに要るのは名前と状態だけ。一覧でも詳細でも同じ形で渡せる */
export interface NotifiableJob {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
}

/**
 * 知らせるべき変化か。
 *
 * 実行中だったものが終わったときにだけ知らせる。画面を開き直しただけで
 * 過去のジョブの通知が出ると、通知そのものが信用されなくなる。
 * previous が無いのは、そのジョブを初めて見たとき
 */
export function shouldNotifyCompletion(
  previous: REVIEW_JOB_STATUS | undefined,
  current: REVIEW_JOB_STATUS
): boolean {
  if (previous === undefined || !isJobRunning(previous)) {
    return false;
  }
  return !isJobRunning(current);
}

/**
 * 審査が終わったことをトーストで知らせる。
 *
 * 審査は数分かかるので、終わるまで画面を見張ることになりがち。一覧か詳細を
 * 開いたままにしておけば、他の画面を触っていても終了に気づける
 */
export function useJobCompletionNotice(jobs: NotifiableJob[]): void {
  const { t } = useTranslation();
  const { addToast } = useToast();
  // 前回見たときの状態。ここに無いジョブは「初めて見た」ので知らせない
  const lastSeenStatus = useRef(new Map<string, REVIEW_JOB_STATUS>());

  useEffect(() => {
    for (const job of jobs) {
      const previous = lastSeenStatus.current.get(job.id);
      lastSeenStatus.current.set(job.id, job.status);
      if (!shouldNotifyCompletion(previous, job.status)) {
        continue;
      }
      const succeeded = job.status === REVIEW_JOB_STATUS.COMPLETED;
      addToast(
        `${succeeded ? t("review.notice.completed") : t("review.notice.failed")}: ${job.name}`,
        succeeded ? "success" : "error",
        // 目を離しているあいだに消えては意味が無いので、既定より長く出す
        NOTICE_DURATION_MS
      );
    }
    // addToast と t は毎回作り直されるので、ジョブの変化だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
}
