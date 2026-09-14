import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentUpload } from "../../../hooks/useDocumentUpload";
import {
  validateFileSize,
  formatFileSize,
} from "../../../utils/fileValidation";
import { MAX_FILE_SIZE, MAX_REVIEW_DOCUMENTS } from "../../../constants/index";
import { REVIEW_FILE_TYPE } from "../types";

/**
 * 審査するファイルの選択。サイズと件数の確認、アップロード、同じ名前の
 * ファイルの確認、削除を扱う。
 *
 * エラーの表示先と、アップロード後にする処理（ジョブ名の初期値など）は
 * 呼び出し側が決める。
 */
export function useReviewFileSelection(params: {
  fileType: REVIEW_FILE_TYPE;
  upload: Pick<
    ReturnType<typeof useDocumentUpload>,
    | "uploadDocuments"
    | "documentsPresignedUrlEndpoint"
    | "imagesPresignedUrlEndpoint"
    | "deleteDocument"
  >;
  /** ファイル欄のエラーを出す */
  setFilesError: (message: string) => void;
  /** アップロードが終わったとき。選択中のファイルを受け取る */
  onUploaded: (files: File[]) => void;
}) {
  const { fileType, upload, setFilesError, onUploaded } = params;
  const { t } = useTranslation();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // 選択したファイルと、そのアップロード先のドキュメントIDの対応。
  // 同じ名前の別ファイルを区別できるよう、名前ではなくファイルそのもので引く
  const [documentIds, setDocumentIds] = useState<Map<File, string>>(
    () => new Map()
  );
  // 同じ名前のファイルをどう扱うか確認している間の、取り込み待ちのファイル
  const [pendingFiles, setPendingFiles] = useState<{
    files: File[];
    duplicates: string[];
  } | null>(null);

  // 選択ファイルを確定し、まだアップロードしていないものをアップロードする。
  // 件数の上限を超える場合は何もせず false を返す
  const applyFiles = async (files: File[]): Promise<boolean> => {
    // ファイル数の検証（PDF・画像とも同じ上限）
    if (files.length > MAX_REVIEW_DOCUMENTS) {
      setFilesError(
        fileType === REVIEW_FILE_TYPE.PDF
          ? t("review.pdfLimitError")
          : t("review.imageLimitError")
      );
      return false;
    }

    setSelectedFiles(files);

    // 新しく追加されたファイルのみをアップロード
    const filesToUpload = files.filter((file) => !documentIds.has(file));

    if (filesToUpload.length === 0) {
      return true;
    }

    try {
      // PDF・画像とも同じ経路で複数アップロードする。
      // エンドポイントだけがファイル種別で変わる
      const results = await upload.uploadDocuments(
        filesToUpload,
        fileType === REVIEW_FILE_TYPE.PDF
          ? upload.documentsPresignedUrlEndpoint
          : upload.imagesPresignedUrlEndpoint
      );

      // 結果は渡したファイルと同じ順に返る
      setDocumentIds((prev) => {
        const next = new Map(prev);
        filesToUpload.forEach((file, index) =>
          next.set(file, results[index].documentId)
        );
        return next;
      });

      onUploaded(files);
    } catch (error) {
      console.error(t("review.fileUploadError"), error);
    }
    return true;
  };

  // アップロード済みのファイルを、ドキュメント一覧とS3から削除する
  const removeUploaded = async (files: File[]) => {
    const ids = files
      .map((file) => documentIds.get(file))
      .filter((id): id is string => id !== undefined);

    setDocumentIds((prev) => {
      const next = new Map(prev);
      files.forEach((file) => next.delete(file));
      return next;
    });

    await Promise.all(ids.map((id) => upload.deleteDocument(id)));
  };

  // ファイル変更ハンドラ
  const handleFilesChange = async (newFiles: File[]) => {
    // ファイルサイズ検証
    const oversizedFiles = newFiles.filter(
      (file) => !validateFileSize(file, MAX_FILE_SIZE)
    );
    if (oversizedFiles.length > 0) {
      const oversizedFileNames = oversizedFiles
        .map((file) => `${file.name} (${formatFileSize(file.size)})`)
        .join(", ");
      setFilesError(`${t("review.fileSizeError")}: ${oversizedFileNames}`);
      return;
    }

    // 既に選択されているファイルと同じ名前のものが追加されたら、
    // 置き換えるか両方残すかを利用者に選んでもらう
    const selectedNames = new Set(selectedFiles.map((file) => file.name));
    const duplicates = [
      ...new Set(
        newFiles
          .filter(
            (file) =>
              !selectedFiles.includes(file) && selectedNames.has(file.name)
          )
          .map((file) => file.name)
      ),
    ];
    if (duplicates.length > 0) {
      setPendingFiles({ files: newFiles, duplicates });
      return;
    }

    await applyFiles(newFiles);
  };

  // 同名ファイルの確認: 選択済みの同名ファイルを新しいファイルに差し替える
  const handleReplaceDuplicates = async () => {
    if (!pendingFiles) {
      return;
    }
    const { files, duplicates } = pendingFiles;
    setPendingFiles(null);

    const replaced = selectedFiles.filter((file) =>
      duplicates.includes(file.name)
    );
    const kept = files.filter((file) => !replaced.includes(file));

    // 上限で弾かれたら、置き換え前の選択をそのまま残す
    if (await applyFiles(kept)) {
      await removeUploaded(replaced);
    }
  };

  // 同名ファイルの確認: 両方とも審査対象にする
  const handleKeepBothDuplicates = async () => {
    if (!pendingFiles) {
      return;
    }
    const { files } = pendingFiles;
    setPendingFiles(null);
    await applyFiles(files);
  };

  // 同名ファイルの確認: 取り込まない
  const cancelDuplicates = () => setPendingFiles(null);

  // ファイル削除ハンドラ
  const handleFileRemove = async (index: number) => {
    const fileToRemove = selectedFiles[index];

    // 選択済みファイルリストから削除
    const newSelectedFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newSelectedFiles);

    // アップロード済みドキュメントリストとS3からも削除
    await removeUploaded([fileToRemove]);

    // ファイルがなくなった場合はエラーを表示
    if (newSelectedFiles.length === 0) {
      setFilesError(t("review.fileRequired"));
    }
  };

  // ファイルの種類を切り替えたときなど、選択をすべて取り消す
  const resetFiles = () => {
    setSelectedFiles([]);
    setDocumentIds(new Map());
    setPendingFiles(null);
  };

  return {
    selectedFiles,
    isFileUploaded: (file: File) => documentIds.has(file),
    pendingDuplicates: pendingFiles?.duplicates ?? null,
    handleFilesChange,
    handleReplaceDuplicates,
    handleKeepBothDuplicates,
    cancelDuplicates,
    handleFileRemove,
    resetFiles,
  };
}
