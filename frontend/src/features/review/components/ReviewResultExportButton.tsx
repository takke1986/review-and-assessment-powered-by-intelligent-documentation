import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HiDownload } from "react-icons/hi";
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
  buildReviewResultCsv,
  downloadCsv,
  toSafeFilename,
} from "../utils/reviewResultCsv";

interface ReviewResultExportButtonProps {
  jobId: string;
  jobName: string;
  documents: ReviewJobDocument[];
}

/**
 * 審査結果を CSV に書き出すボタン。
 *
 * 画面のツリーは開いた枝だけを読み込むので、書き出すときに改めて全件を取る。
 * 押されるまで取りに行かないのは、項目数の多いチェックリストでは
 * 画面を開くだけで重い問い合わせが走ってしまうため
 */
export default function ReviewResultExportButton({
  jobId,
  jobName,
  documents,
}: ReviewResultExportButtonProps) {
  const { t } = useTranslation();
  const http = useHttp();
  const { addToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
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
      const csv = buildReviewResultCsv({
        jobName,
        results,
        documents,
        t,
      });
      // 同じジョブを何度も書き出すので、日付だけでなく時刻も名前に入れる
      const stamp = new Date()
        .toISOString()
        .slice(0, 16)
        .replace(/[-:]/g, "")
        .replace("T", "-");
      downloadCsv(`${toSafeFilename(jobName)}-${stamp}.csv`, csv);
    } catch (error) {
      console.error(error);
      addToast(t("review.export.error"), "error");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant="secondary"
      outline
      onClick={handleExport}
      disabled={isExporting}
      icon={isExporting ? <Spinner size="sm" /> : <HiDownload />}>
      {t("review.export.button")}
    </Button>
  );
}
