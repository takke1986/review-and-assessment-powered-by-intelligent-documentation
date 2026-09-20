import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HiClipboardCopy } from "react-icons/hi";
import Button from "../../../components/Button";
import Spinner from "../../../components/Spinner";
import useHttp from "../../../hooks/useHttp";
import { useToast } from "../../../contexts/ToastContext";
import type {
  GetReviewResultItemsResponse,
  ReviewJobDocument,
  ReviewResultDetail,
} from "../types";
import {
  buildReviewResultText,
  copyToClipboard,
} from "../utils/reviewResultText";

interface ReviewResultTextButtonProps {
  jobId: string;
  jobName: string;
  checkListName: string;
  completedAt?: Date;
  documents: ReviewJobDocument[];
}

/**
 * 審査結果を、そのまま貼れる文章にして写す。
 *
 * 結果を人に伝えるのはたいてい文章で、その下書きは生成AIに任せることが
 * 多い。CSV は表なので、文章を書かせる相手に渡すには向かない
 */
export default function ReviewResultTextButton({
  jobId,
  jobName,
  checkListName,
  completedAt,
  documents,
}: ReviewResultTextButtonProps) {
  const { t } = useTranslation();
  const http = useHttp();
  const { addToast } = useToast();
  const [isWorking, setIsWorking] = useState(false);

  const handleCopy = async () => {
    setIsWorking(true);
    try {
      const response = await http.getOnce<GetReviewResultItemsResponse>(
        `/review-jobs/${jobId}/results/items`,
        { includeAllChildren: true }
      );
      const results: ReviewResultDetail[] = response.data.success
        ? response.data.data
        : [];
      if (results.length === 0) {
        addToast(t("review.export.empty"), "info");
        return;
      }
      const text = buildReviewResultText({
        jobName,
        checkListName,
        completedAt,
        documents,
        results,
        t,
      });
      // クリップボードは断られることがある。黙って失敗せず、結果を伝える
      const copied = await copyToClipboard(text);
      addToast(
        copied ? t("review.report.copied") : t("review.report.copyFailed"),
        copied ? "success" : "error"
      );
    } catch (error) {
      console.error(error);
      addToast(t("review.export.error"), "error");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Button
      variant="secondary"
      outline
      onClick={handleCopy}
      disabled={isWorking}
      icon={isWorking ? <Spinner size="sm" /> : <HiClipboardCopy />}>
      {t("review.report.copyText")}
    </Button>
  );
}
