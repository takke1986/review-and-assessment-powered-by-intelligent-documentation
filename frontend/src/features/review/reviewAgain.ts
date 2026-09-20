import { REVIEW_JOB_STATUS } from "./types";

/**
 * このジョブを元に、もう一度審査を流せるか。
 * バックエンドの canReviewAgain と同じ決め方にする。
 *
 * 途中で終わった審査も元にできる。引き継ぎの処理は「完了した項目は写し、
 * そうでない項目は審査し直す」作りなので、続きから流せる
 */
export const canReviewAgain = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.COMPLETED ||
  status === REVIEW_JOB_STATUS.FAILED ||
  status === REVIEW_JOB_STATUS.CANCELLED;

/**
 * 途中で終わったジョブか。
 *
 * 完了なら「不合格を審査し直す」、途中で終わったなら「続きから」で、
 * 利用者のすることが違うので、言い回しを変える
 */
export const endedEarly = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.FAILED ||
  status === REVIEW_JOB_STATUS.CANCELLED;
