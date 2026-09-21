import { useTranslation } from "react-i18next";
import Button from "../../../components/Button";
import ReviewResultExportButton from "./ReviewResultExportButton";
import ReviewResultTextButton from "./ReviewResultTextButton";
import { useReviewJobActions } from "../hooks/useReviewJobActions";
import { canResume, canReviewAgain } from "../reviewJobRules";
import { isJobRunning, type ReviewJobDetail } from "../types";

interface ReviewJobActionsProps {
  job: ReviewJobDetail;
  /** 状態が変わったら詳細を読み直す */
  onChanged: () => void;
}

/**
 * この審査に対してできること。
 *
 * 止める・公開する・もう一度流す・持ち出す、と種類が増えたので、
 * 見出しの中に並べたままだと何がいつ出るのか追えなくなっていた。
 *
 * 出す・出さないの判断はここに集める。直せるかどうかはサーバの返事に従い、
 * 画面では判定しない
 */
export default function ReviewJobActions({
  job,
  onChanged,
}: ReviewJobActionsProps) {
  const { t } = useTranslation();
  const actions = useReviewJobActions(job.id, onChanged);
  // 持ち主かどうかはサーバが答える。画面側で判定すると規則がずれる
  const canEdit = job.canEdit !== false;

  return (
    <>
      <div className="flex flex-col items-stretch gap-2 self-start">
        {/* 走っている審査は止められる。間違えて始めたときに、終わるまで
            待って費用も払うのはおかしい */}
        {canEdit && isJobRunning(job.status) && (
          <Button
            variant="danger"
            outline
            disabled={actions.isWorking}
            onClick={() => {
              if (window.confirm(t("review.cancelConfirm"))) {
                actions.cancel();
              }
            }}>
            {t("review.cancel")}
          </Button>
        )}

        {/* 同じ部署の審査は読めるが、直せるのは作成者だけ。ボタンを出さない
            だけだと権限の問題だと思われるので、理由を書く */}
        {!canEdit && (
          <p className="rounded-lg border border-light-gray bg-aws-paper-light p-3 text-sm text-aws-font-color-gray">
            {t("review.readOnlyByOther")}
          </p>
        )}
      </div>

      {canReviewAgain(job.status) && (
        <div className="flex flex-col items-stretch gap-2 self-start">
          {/* 途中で終わった審査は、そのジョブのまま続きから埋める。
              別のジョブを作ると、同じ書類の審査が履歴に2行並んで
              どちらが本物か分からなくなる */}
          {canResume(job.status) && canEdit && (
            <Button
              variant="primary"
              outline
              loading={actions.isWorking}
              onClick={actions.resume}>
              {t("review.resumeReview")}
            </Button>
          )}

          {/* 完了した審査は、文書を直して見てもらうので別のジョブになる。
              元の結果は残したまま、不合格だった項目だけを審査し直す */}
          {!canResume(job.status) && (
            <Button
              to={`/review/create?source=${job.id}`}
              variant="primary"
              outline>
              {t("review.rerunFailedItems")}
            </Button>
          )}

          {/* 紙に出す。顧客に渡したり綴じたりするのは画面の外 */}
          <Button to={`/review/${job.id}/report`} variant="secondary" outline>
            {t("review.report.open")}
          </Button>

          {/* 文章にして写す。メール文の下書きは生成AIに任せることが多い */}
          <ReviewResultTextButton
            jobId={job.id}
            jobName={job.name}
            checkListName={job.checkList.name}
            completedAt={job.completedAt}
            documents={job.documents}
          />

          {/* 表計算ソフトに持ち出す。並べ替えや集計は手元の方が早い */}
          <ReviewResultExportButton
            jobId={job.id}
            jobName={job.name}
            documents={job.documents}
          />
        </div>
      )}
    </>
  );
}
