import { REVIEW_JOB_STATUS } from "../model/review";

/**
 * 審査を途中で止められるか。
 *
 * 終わったものを止めても意味がなく、二重に止めても困る。
 * 待ち行列にいるもの（pending）と走っているもの（processing）だけが対象
 */
export const canCancel = (status: REVIEW_JOB_STATUS): boolean =>
  status === REVIEW_JOB_STATUS.PENDING ||
  status === REVIEW_JOB_STATUS.PROCESSING;

/**
 * 止まったあと、状態を書き換えてよいか。
 *
 * 中止したジョブに、あとから届いた処理が「処理中」や「失敗」を
 * 上書きすると、止めたはずのものが動いているように見える。
 * 中止は人が決めたことなので、あとからの自動更新より強い
 */
export const shouldKeepCancelled = (
  current: REVIEW_JOB_STATUS,
  incoming: REVIEW_JOB_STATUS
): boolean =>
  current === REVIEW_JOB_STATUS.CANCELLED &&
  incoming !== REVIEW_JOB_STATUS.CANCELLED;
