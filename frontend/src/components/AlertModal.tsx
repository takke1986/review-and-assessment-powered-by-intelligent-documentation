import { useTranslation } from "react-i18next";
import {
  HiExclamation,
  HiExclamationCircle,
  HiInformationCircle,
  HiCheckCircle,
} from "react-icons/hi";
import Modal from "./Modal";
import Button from "./Button";

export type AlertType = "info" | "success" | "warning" | "error" | "confirm";

export interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  type?: AlertType;
  confirmButtonText?: string;
  cancelButtonText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

/**
 * アラートモーダルコンポーネント
 * エラー、警告、情報、成功、確認などの通知を表示するためのモーダル
 */
export default function AlertModal({
  isOpen,
  onClose,
  title,
  message,
  type = "info",
  confirmButtonText,
  cancelButtonText,
  onConfirm,
  onCancel,
}: AlertModalProps) {
  const { t } = useTranslation();

  // タイプに応じたタイトル、アイコン、色を設定
  const getAlertConfig = () => {
    switch (type) {
      case "success":
        return {
          icon: <HiCheckCircle className="h-8 w-8 text-green-500" />,
          defaultTitle: t("common.success"),
          buttonColor: "primary",
        };
      case "error":
        return {
          icon: <HiExclamationCircle className="text-red-500 h-8 w-8" />,
          defaultTitle: t("common.error"),
          buttonColor: "danger",
        };
      case "warning":
        return {
          icon: <HiExclamation className="text-yellow-500 h-8 w-8" />,
          defaultTitle: t("common.warning"),
          buttonColor: "warning",
        };
      case "confirm":
        return {
          icon: <HiExclamationCircle className="h-8 w-8 text-blue-500" />,
          defaultTitle: t("common.confirmation"),
          buttonColor: "primary",
        };
      case "info":
      default:
        return {
          icon: <HiInformationCircle className="h-8 w-8 text-blue-500" />,
          defaultTitle: t("common.information"),
          buttonColor: "primary",
        };
    }
  };

  const { icon, defaultTitle,} = getAlertConfig();
  const modalTitle = title || defaultTitle;

  // 確認ボタンクリック時の処理
  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
  };

  // キャンセルボタンクリック時の処理
  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center">
          <span className="mr-2">{icon}</span>
          {modalTitle}
        </div>
      }
      size="sm">
      <div className="mb-4">
        <p className="text-aws-squid-ink-light">{message}</p>
      </div>

      <div className="mt-4 flex justify-end space-x-2">
        {type === "confirm" && (
          <Button outline onClick={handleCancel}>
            {cancelButtonText || t("common.cancel")}
          </Button>
        )}
        <Button
          variant={type === "error" ? "danger" : "primary"}
          onClick={handleConfirm}>
          {confirmButtonText || t("common.ok")}
        </Button>
      </div>
    </Modal>
  );
}
