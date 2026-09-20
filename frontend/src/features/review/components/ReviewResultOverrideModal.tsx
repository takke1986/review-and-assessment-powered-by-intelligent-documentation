/**
 * Modal for users to override review results
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ReviewResultDetail,
  OverrideReviewResultRequest,
  OVERRIDE_REASON,
  OVERRIDE_REASONS,
} from "../types";
import { useUpdateReviewResult } from "../hooks/useReviewResultMutations";
import { REVIEW_RESULT } from "../types";
import Modal from "../../../components/Modal";
import Button from "../../../components/Button";
import FormTextArea from "../../../components/FormTextArea";
import RadioGroup from "../../../components/RadioGroup";
import { HiCheck } from "react-icons/hi";

interface ReviewResultOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: ReviewResultDetail;
}

export default function ReviewResultOverrideModal({
  isOpen,
  onClose,
  result,
}: ReviewResultOverrideModalProps) {
  const { t } = useTranslation();
  const { updateReviewResult, status,} = useUpdateReviewResult(
    result.reviewJobId
  );
  const isSubmitting = status === "loading";

  // フォーム状態
  const [formData, setFormData] = useState<OverrideReviewResultRequest>({
    result: result.result || REVIEW_RESULT.FAIL,
    userComment: result.userComment || "",
    overrideReason: result.overrideReason,
  });

  /**
   * AI が下した判定。
   *
   * 記録していなかった頃の結果には無いので、まだ誰も覆していなければ
   * いまの判定が AI のもの、と補う（バックエンドと同じ決め方）
   */
  const aiVerdict =
    result.aiResult ?? (result.userOverride ? undefined : result.result);

  // AI と違う判定にするときだけ理由を聞く。同じなら覆していない
  const isOverturning =
    aiVerdict !== undefined && formData.result !== aiVerdict;

  // Radio button options
  const resultOptions = [
    { value: REVIEW_RESULT.PASS, label: t("review.pass") },
    { value: REVIEW_RESULT.FAIL, label: t("review.fail") },
  ];

  // フォーム入力ハンドラー
  const handleResultChange = (value: string) => {
    setFormData((prev) => ({ ...prev, result: value as REVIEW_RESULT }));
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, userComment: e.target.value }));
  };

  // 保存ハンドラー
  const handleSave = async () => {
    try {
      // バックエンドから提供される reviewJobId を使用
      const jobId = result.reviewJobId;

      // jobId が存在しない場合はエラー処理
      if (!jobId) {
        console.error("Review job ID is missing");
        return;
      }

      await updateReviewResult(result.id, formData);

      onClose();
    } catch (error) {
      console.error("Failed to update review result:", error);
    }
  };

  if (!isOpen) return null;

  // checkList が undefined の場合のフォールバック
  if (!result.checkList) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title={t("common.error")}>
        <div className="text-red">
          {t("review.dataError")}: {t("review.noChecklistInfo")}
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("review.overrideResult")}>
      <div className="space-y-6">
        <div className="border-b border-light-gray pb-4">
          <h3 className="mb-2 font-medium text-aws-squid-ink-light">
            {t("checklist.items")}
          </h3>
          <p className="text-aws-squid-ink-light">{result.checkList.name}</p>
          <p className="mt-1 text-sm text-aws-font-color-gray">
            {result.checkList.description || t("checklist.noDescription")}
          </p>
        </div>

        <div className="border-b border-light-gray pb-4">
          <h3 className="mb-2 font-medium text-aws-squid-ink-light">
            {t("review.aiDecision")}
          </h3>
          <p className="text-aws-font-color-gray">
            {result.explanation ||
              t("review.noExplanation", "No judgment results available")}
          </p>
        </div>

        <div className="border-b border-light-gray pb-4">
          <h3 className="mb-2 font-medium text-aws-squid-ink-light">
            {t("review.judgmentResult", "Judgment Result")}
          </h3>
          <RadioGroup
            name="result"
            options={resultOptions}
            value={formData.result}
            onChange={handleResultChange}
            inline={true}
          />
        </div>

        {/* 覆すときだけ理由を聞く。集められると、どの項目の何を直せばよいかが
            傾向から読める。自由記述だけでは並べて数えられない */}
        {isOverturning && (
          <div className="border-b border-light-gray pb-4">
            <h3 className="mb-1 font-medium text-aws-squid-ink-light">
              {t("review.overrideReason")}
            </h3>
            <p className="mb-2 text-sm text-aws-font-color-gray">
              {aiVerdict === REVIEW_RESULT.FAIL
                ? t("review.overrideReasonHintTooStrict")
                : t("review.overrideReasonHintMissed")}
            </p>
            <RadioGroup
              name="overrideReason"
              options={OVERRIDE_REASONS.map((value) => ({
                value,
                label: t(`review.overrideReasons.${value}`),
              }))}
              value={formData.overrideReason ?? ""}
              onChange={(value) =>
                setFormData((prev) => ({
                  ...prev,
                  overrideReason: value as OVERRIDE_REASON,
                }))
              }
            />
          </div>
        )}

        <div>
          <FormTextArea
            id="userComment"
            name="userComment"
            label={t("review.userComment")}
            value={formData.userComment || ""}
            onChange={handleCommentChange}
            placeholder={t(
              "review.commentPlaceholder",
              "Enter the reason for the override or additional information"
            )}
            rows={4}
            className="mb-0"
          />
        </div>

        <div className="flex justify-end space-x-3 border-t border-light-gray pt-4">
          <Button onClick={onClose} outline disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSubmitting}
            loading={isSubmitting}
            icon={<HiCheck className="h-5 w-5" />}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
