import { useTranslation } from "react-i18next";
import { HiInformationCircle } from "react-icons/hi";
import Button from "./Button";

interface ErrorAlertProps {
  // エラーの元の情報をそのまま受け取れるように
  error: string | Error | null;
  // カスタムタイトルとメッセージのオプション
  title?: string;
  message?: string;
  // リトライ機能を維持
  retry?: () => void;
}

export function ErrorAlert({ error, title, message, retry }: ErrorAlertProps) {
  const { t } = useTranslation();

  // エラーメッセージの処理
  const errorMessage =
    message ||
    (typeof error === "object"
      ? (error as Error).message || "An error occurred"
      : error);

  // デフォルトのタイトル
  const errorTitle = title || t("common.error");

  return (
    <div
      className="rounded-lg border border-red bg-light-red px-6 py-4 text-red shadow-md"
      role="alert">
      <div className="flex items-center">
        <HiInformationCircle className="mr-2 h-6 w-6" />
        <strong className="font-medium">{errorTitle}: </strong>
        <span className="ml-2">{errorMessage}</span>
        {retry && (
          <Button
            onClick={retry}
            variant="text"
            size="sm"
            className="hover:text-red-800 ml-2 text-red underline">
            {t("common.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}

export default ErrorAlert;
