import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Button from "../../../components/Button";
import PageHeader from "../../../components/PageHeader";
import FormTextField from "../../../components/FormTextField";
import { FormTextArea } from "../../../components/FormTextArea";
import { FileUploader } from "../../../components/FileUploader";
import ChecklistSelector from "../components/ChecklistSelector";
import ComparisonIndicator from "../components/ComparisonIndicator";
import DuplicateFileModal from "../components/DuplicateFileModal";
import CheckItemPicker from "../components/CheckItemPicker";
import RerunDocumentPicker from "../components/RerunDocumentPicker";
import { useCreateReviewJob } from "../hooks/useReviewJobMutations";
import { useReviewJobDetail } from "../hooks/useReviewJobQueries";
import { useAllReviewResults } from "../hooks/useReviewResultQueries";
import { useDocumentUpload } from "../../../hooks/useDocumentUpload";
import { useChecklistSets } from "../../checklist/hooks/useCheckListSetQueries";
import { CHECK_LIST_STATUS, CheckListSet } from "../../checklist/types";
import {
  HiExclamationCircle,
  HiDocumentText,
  HiPhotograph,
} from "react-icons/hi";
import SegmentedControl from "../../../components/SegmentedControl";
import {
  REVIEW_FILE_TYPE,
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
} from "../types";
import {
  validateFileSize,
  formatFileSize,
} from "../../../utils/fileValidation";
import {
  MAX_FILE_SIZE,
  MAX_REVIEW_DOCUMENTS,
  MAX_REVISION_NOTE_LENGTH,
} from "../../../constants/index";

export const CreateReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // 再審査: ?source=<ジョブID> で開くと、そのジョブで不合格だった項目を
  // 差し替えた文書で審査し直す。選ばなかった項目は元の結果を引き継ぐ
  const [searchParams] = useSearchParams();
  const sourceJobId = searchParams.get("source");
  const { job: sourceJob } = useReviewJobDetail(sourceJobId);
  const { items: sourceResults, isLoading: isLoadingSourceResults } =
    useAllReviewResults(sourceJobId);
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
  const [selectedChecklist, setSelectedChecklist] =
    useState<CheckListSet | null>(null);
  // 審査するチェック項目（子を持たない項目のID）と、選べる項目の数。
  // 項目の読み込みが終わるまでは null
  const [checkSelection, setCheckSelection] = useState<{
    ids: Set<string>;
    total: number;
  } | null>(null);
  const [jobName, setJobName] = useState("");
  // 再審査で何を直したかのメモ（任意）
  const [revisionNote, setRevisionNote] = useState("");
  const isRevisionNoteTooLong =
    revisionNote.trim().length > MAX_REVISION_NOTE_LENGTH;
  // 再審査: 元のジョブの文書のうち引き継ぐもの（読み込むまでは null）と、
  // アップロードした文書（ドキュメントID）ごとの差し替え対象（空文字は追加）
  const [keptSourceDocumentIds, setKeptSourceDocumentIds] =
    useState<Set<string> | null>(null);
  const [replacements, setReplacements] = useState<Record<string, string>>(
    {}
  );
  const [fileType, setFileType] = useState<REVIEW_FILE_TYPE>(
    REVIEW_FILE_TYPE.PDF
  );
  const [checklistPage, setChecklistPage] = useState(1);
  const [checklistLimit] = useState(5);
  const [errors, setErrors] = useState({
    name: "",
    files: "",
  });

  // チェックリストセット一覧を取得（完成状態のみ）
  const {
    items: checkListSets,
    isLoading: isLoadingCheckListSets,
    error: checkListSetsError,
    total: checklistTotal,
    totalPages: checklistTotalPages,
  } = useChecklistSets(
    checklistPage,
    checklistLimit,
    "id",
    "desc",
    CHECK_LIST_STATUS.COMPLETED
  );

  // 審査ジョブ作成フック
  const { createReviewJob, status, error: createError } = useCreateReviewJob();
  const isSubmitting = status === "loading";

  // ドキュメントアップロードフック
  const {
    uploadDocuments,
    documentsPresignedUrlEndpoint,
    imagesPresignedUrlEndpoint,
    clearUploadedDocuments,
    deleteDocument,
    isUploading,
    error: uploadError,
    uploadedDocuments,
  } = useDocumentUpload({
    presignedUrlEndpoint: "/documents/review/presigned-url",
    documentsPresignedUrlEndpoint: "/documents/review/documents/presigned-url",
    imagesPresignedUrlEndpoint: "/documents/review/images/presigned-url",
    deleteEndpointPrefix: "/documents/review/",
  });

  // 再審査で最初に選んでおく項目: 元のジョブで不合格だった子項目と、
  // 審査が完了しなかった子項目（バックエンドの既定と同じ）
  const failedCheckIds = useMemo(() => {
    if (!sourceJobId || isLoadingSourceResults) return undefined;
    const parentIds = new Set(
      sourceResults.map((result) => result.checkList.parentId)
    );
    return sourceResults
      .filter((result) => !parentIds.has(result.checkId))
      .filter(
        (result) =>
          result.status !== REVIEW_RESULT_STATUS.COMPLETED ||
          result.result === REVIEW_RESULT.FAIL
      )
      .map((result) => result.checkId);
  }, [sourceJobId, isLoadingSourceResults, sourceResults]);
  const failedCheckIdSet = useMemo(
    () => new Set(failedCheckIds ?? []),
    [failedCheckIds]
  );

  // 再審査では元のジョブのチェックリストを使う
  const checkListSetId = sourceJobId
    ? (sourceJob?.checkList.id ?? null)
    : (selectedChecklist?.id ?? null);

  // 再審査のジョブ名の初期値（利用者が入力していれば変えない）
  const jobNameInitialized = useRef(false);
  useEffect(() => {
    if (!sourceJob || jobNameInitialized.current) return;
    jobNameInitialized.current = true;
    setJobName(
      (name) => name || `${sourceJob.name}${t("review.rerunJobNameSuffix")}`
    );
  }, [sourceJob, t]);

  // 再審査では、元のジョブの文書を最初はすべて引き継ぐ。変更していない文書が
  // 外れると、複数の文書を見比べる項目が片方の文書だけで審査されてしまう
  useEffect(() => {
    if (!sourceJob || keptSourceDocumentIds !== null) return;
    setKeptSourceDocumentIds(
      new Set(sourceJob.documents.map((doc) => doc.id))
    );
    const sourceFileType = sourceJob.documents[0]?.fileType;
    if (sourceFileType) setFileType(sourceFileType);
  }, [sourceJob, keptSourceDocumentIds]);

  // アップロードした文書と同じ名前の元の文書が1つだけあれば、差し替え対象にしておく
  useEffect(() => {
    if (!sourceJob) return;
    setReplacements((current) => {
      const next = { ...current };
      let changed = false;
      for (const doc of uploadedDocuments) {
        if (doc.documentId in next) continue;
        const taken = new Set(Object.values(next));
        const sameName = sourceJob.documents.filter(
          (source) => source.filename === doc.filename && !taken.has(source.id)
        );
        next[doc.documentId] = sameName.length === 1 ? sameName[0].id : "";
        changed = true;
      }
      return changed ? next : current;
    });
  }, [sourceJob, uploadedDocuments]);

  const replacedSourceDocumentIds = new Set(
    uploadedDocuments
      .map((doc) => replacements[doc.documentId])
      .filter((id): id is string => !!id)
  );
  // 引き継ぐ文書: 引き継ぐと選ばれていて、差し替えられていないもの
  const keptDocumentIds = sourceJob
    ? sourceJob.documents
        .map((doc) => doc.id)
        .filter(
          (id) =>
            keptSourceDocumentIds?.has(id) && !replacedSourceDocumentIds.has(id)
        )
    : [];
  const documentCount = uploadedDocuments.length + keptDocumentIds.length;

  // ファイルが選択されチェックリストも選択されているかチェック
  const isReady =
    documentCount > 0 &&
    checkListSetId !== null &&
    (checkSelection?.ids.size ?? 0) > 0 &&
    !isRevisionNoteTooLong &&
    jobName.trim() !== "";

  // ファイルタイプ選択ハンドラ
  const handleFileTypeChange = (value: string) => {
    setFileType(value as REVIEW_FILE_TYPE);
    setSelectedFiles([]);
    setDocumentIds(new Map());
    setPendingFiles(null);
    clearUploadedDocuments();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === "jobName") {
      setJobName(value);
    }

    // 入力時にエラーをクリア
    if (errors[name as keyof typeof errors]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
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
      setErrors((prev) => ({
        ...prev,
        files: `${t("review.fileSizeError")}: ${oversizedFileNames}`,
      }));
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

  // 選択ファイルを確定し、まだアップロードしていないものをアップロードする。
  // 件数の上限を超える場合は何もせず false を返す
  const applyFiles = async (files: File[]): Promise<boolean> => {
    // ファイル数の検証（PDF・画像とも同じ上限）
    if (files.length > MAX_REVIEW_DOCUMENTS) {
      setErrors((prev) => ({
        ...prev,
        files:
          fileType === REVIEW_FILE_TYPE.PDF
            ? t("review.pdfLimitError")
            : t("review.imageLimitError"),
      }));
      return false;
    }

    setSelectedFiles(files);

    // 新しく追加されたファイルのみをアップロード
    const filesToUpload = files.filter((file) => !documentIds.has(file));

    if (filesToUpload.length === 0) return true;

    try {
      // PDF・画像とも同じ経路で複数アップロードする。
      // エンドポイントだけがファイル種別で変わる
      const results = await uploadDocuments(
        filesToUpload,
        fileType === REVIEW_FILE_TYPE.PDF
          ? documentsPresignedUrlEndpoint
          : imagesPresignedUrlEndpoint
      );

      // 結果は渡したファイルと同じ順に返る
      setDocumentIds((prev) => {
        const next = new Map(prev);
        filesToUpload.forEach((file, index) =>
          next.set(file, results[index].documentId)
        );
        return next;
      });

      // ファイル名をジョブ名の初期値として設定（ファイルが1つの場合）
      if (files.length === 1 && !jobName) {
        const fileName = files[0].name;
        const nameWithoutExtension =
          fileName.substring(0, fileName.lastIndexOf(".")) || fileName;
        setJobName(`${nameWithoutExtension}${t("review.jobNameSuffix")}`);
      }

      // ファイル選択時にエラーをクリア
      if (errors.files) {
        setErrors((prev) => ({
          ...prev,
          files: "",
        }));
      }
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

    await Promise.all(ids.map((id) => deleteDocument(id)));
  };

  // 同名ファイルの確認: 選択済みの同名ファイルを新しいファイルに差し替える
  const handleReplaceDuplicates = async () => {
    if (!pendingFiles) return;
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
    if (!pendingFiles) return;
    const { files } = pendingFiles;
    setPendingFiles(null);
    await applyFiles(files);
  };

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
      setErrors((prev) => ({
        ...prev,
        files: t("review.fileRequired"),
      }));
    }
  };

  // チェックリスト選択ハンドラ
  const handleChecklistSelect = (checklist: CheckListSet) => {
    if (checklist.id !== selectedChecklist?.id) {
      setCheckSelection(null);
    }
    setSelectedChecklist(checklist);
  };

  // バリデーション
  const validate = () => {
    const newErrors = {
      name: "",
      files: "",
    };

    if (!jobName.trim()) {
      newErrors.name = t("review.nameRequired");
    }

    if (documentCount === 0) {
      newErrors.files = t("review.fileRequired");
    }

    setErrors(newErrors);
    return !Object.values(newErrors).some((error) => error);
  };

  // フォーム送信ハンドラ
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate() || !checkListSetId) return;

    try {
      // すべてのドキュメントを同じ構造で扱う
      const documents = uploadedDocuments.map((doc) => ({
        id: doc.documentId,
        filename: doc.filename,
        s3Key: doc.s3Key,
        fileType: fileType,
        replacesDocumentId: sourceJobId
          ? replacements[doc.documentId] || undefined
          : undefined,
      }));

      await createReviewJob({
        name: jobName,
        checkListSetId,
        documents: documents,
        // 再審査では選んだ項目を必ず送る（省略すると元のジョブで不合格だった
        // 項目になる）。通常の審査では、すべて選んでいるときは送らず、
        // 従来どおり全項目を審査する
        checkIds:
          checkSelection &&
          (sourceJobId || checkSelection.ids.size < checkSelection.total)
            ? Array.from(checkSelection.ids)
            : undefined,
        sourceReviewJobId: sourceJobId ?? undefined,
        revisionNote:
          sourceJobId && revisionNote.trim() ? revisionNote.trim() : undefined,
        keptDocumentIds: sourceJobId ? keptDocumentIds : undefined,
      });

      clearUploadedDocuments();

      // 作成成功後、一覧ページに遷移
      navigate("/review", { replace: true });
    } catch (error) {
      console.error(t("review.createError"), error);
    }
  };

  // 表示するエラー
  const displayError = uploadError || createError;

  return (
    <div>
      <PageHeader
        title={sourceJobId ? t("review.rerunTitle") : t("review.createTitle")}
        description={
          sourceJobId
            ? t("review.rerunDescription")
            : t("review.createDescription")
        }
        backLink={{
          to: "/review",
          label: t("review.backToList"),
        }}
      />

      {displayError && (
        <div
          className="mb-6 rounded-md border border-red bg-light-red px-6 py-4 text-red shadow-sm"
          role="alert">
          <div className="flex items-center">
            <HiExclamationCircle className="mr-2 h-6 w-6" />
            <strong className="font-medium">{t("common.error")}: </strong>
            <span className="ml-2">{displayError.message}</span>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-light-gray bg-white p-6 shadow-md">
        <form onSubmit={handleSubmit}>
          <FormTextField
            id="jobName"
            name="jobName"
            label={t("review.jobName")}
            value={jobName}
            onChange={handleInputChange}
            placeholder={t("review.jobNamePlaceholder")}
            required
            error={errors.name}
          />

          {/* 再審査: 何を直したかを残しておくと、後から見返したときに分かる */}
          {sourceJobId && (
            <FormTextArea
              id="revisionNote"
              name="revisionNote"
              label={t("review.revisionNote")}
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder={t("review.revisionNotePlaceholder")}
              rows={3}
              error={
                isRevisionNoteTooLong
                  ? t("review.revisionNoteTooLong", {
                      max: MAX_REVISION_NOTE_LENGTH,
                    })
                  : undefined
              }
            />
          )}

          {/* 再審査では元のジョブと同じファイルの種類にする */}
          {!sourceJobId && (
          <div className="mb-6">
            <label className="mb-2 block font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
              {t("review.fileType")} <span className="text-red">*</span>
            </label>
            <SegmentedControl
              name="fileType"
              options={[
                {
                  value: REVIEW_FILE_TYPE.PDF,
                  label: t("review.pdfFile"),
                  icon: <HiDocumentText />,
                },
                {
                  value: REVIEW_FILE_TYPE.IMAGE,
                  label: t("review.imageFiles"),
                  icon: <HiPhotograph />,
                },
              ]}
              value={fileType}
              onChange={handleFileTypeChange}
            />
          </div>
          )}

          <div className="mb-2">
            <label className="block font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
              {t("review.targetFiles")} <span className="text-red">*</span>
            </label>
            {errors.files && (
              <p className="mt-1 text-sm text-red">{errors.files}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-7">
            {/* 左側: ファイルアップロード */}
            <div className="flex lg:col-span-3">
              <FileUploader
                files={selectedFiles}
                onFilesChange={handleFilesChange}
                isUploading={isUploading}
                multiple={true}
                uploadedDocuments={uploadedDocuments}
                isFileUploaded={(file) => documentIds.has(file)}
                onDeleteFile={handleFileRemove}
                fillHeight
                acceptedFileTypes={
                  fileType === REVIEW_FILE_TYPE.PDF
                    ? { "application/pdf": [".pdf"] }
                    : { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }
                }
              />
            </div>

            {/* 中央: 比較アイコン */}
            <div className="flex items-center justify-center py-4 lg:col-span-1">
              <ComparisonIndicator isReady={isReady} />
            </div>

            {/* 右側: チェックリスト選択（再審査では元のジョブを表示） */}
            <div className="lg:col-span-3">
              {sourceJobId ? (
                <div className="rounded-md border border-light-gray bg-white p-4 shadow-sm dark:bg-aws-squid-ink-dark">
                  <h3 className="text-lg font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
                    {t("review.rerunSourceJob")}
                  </h3>
                  {sourceJob ? (
                    <>
                      <p className="mt-2">
                        <Link
                          to={`/review/${sourceJob.id}`}
                          className="text-aws-font-color-blue hover:underline">
                          {sourceJob.name}
                        </Link>
                      </p>
                      <p className="mt-1 text-sm text-aws-font-color-gray">
                        {t("review.checklist")}: {sourceJob.checkList.name}
                      </p>
                    </>
                  ) : (
                    <div className="flex items-center justify-center p-8">
                      <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2 border-t-2"></div>
                    </div>
                  )}
                </div>
              ) : isLoadingCheckListSets ? (
                <div className="flex h-full items-center justify-center p-8">
                  <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2 border-t-2"></div>
                </div>
              ) : checkListSetsError ? (
                <div className="rounded-md border border-red p-4 text-red">
                  {t("checklist.loadError")}
                </div>
              ) : (
                <ChecklistSelector
                  checklists={checkListSets || []}
                  selectedChecklistId={selectedChecklist?.id || null}
                  onSelectChecklist={handleChecklistSelect}
                  currentPage={checklistPage}
                  totalPages={checklistTotalPages}
                  totalItems={checklistTotal}
                  itemsPerPage={checklistLimit}
                  onPageChange={setChecklistPage}
                  isLoading={isLoadingCheckListSets}
                />
              )}
            </div>
          </div>

          {/* 再審査: 元のジョブの文書を引き継ぐか、差し替えるか */}
          {sourceJob && keptSourceDocumentIds && (
            <div className="mt-6">
              <RerunDocumentPicker
                sourceDocuments={sourceJob.documents}
                keptIds={keptSourceDocumentIds}
                onToggleKeep={(id) =>
                  setKeptSourceDocumentIds((current) => {
                    const next = new Set(current ?? []);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                uploadedDocuments={uploadedDocuments}
                replacements={replacements}
                onChangeReplacement={(uploadedId, sourceId) =>
                  setReplacements((current) => ({
                    ...current,
                    [uploadedId]: sourceId,
                  }))
                }
              />
            </div>
          )}

          {/* 審査するチェック項目 */}
          {checkListSetId && (!sourceJobId || failedCheckIds) && (
            <div className="mt-6">
              <CheckItemPicker
                setId={checkListSetId}
                selectedIds={checkSelection?.ids ?? new Set()}
                onChange={(ids, total) => setCheckSelection({ ids, total })}
                initialSelectedIds={failedCheckIds}
                markedIds={failedCheckIdSet}
                markLabel={t("review.previousFail")}
                helpText={
                  sourceJobId ? t("review.rerunSelectionHelp") : undefined
                }
              />
            </div>
          )}

          <div className="mt-8 flex justify-end space-x-3">
            <Button outline to="/review">
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!isReady || isSubmitting || isUploading}>
              {isSubmitting || isUploading ? (
                <>
                  <div className="-ml-1 mr-2 h-4 w-4 animate-spin text-white">
                    <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent"></div>
                  </div>
                  {t("common.processing")}
                </>
              ) : (
                t("review.compare")
              )}
            </Button>
          </div>
        </form>
      </div>

      {/* フォームの外に置く: ボタンがフォーム送信にならないように */}
      <DuplicateFileModal
        isOpen={pendingFiles !== null}
        filenames={pendingFiles?.duplicates ?? []}
        onReplace={handleReplaceDuplicates}
        onKeepBoth={handleKeepBothDuplicates}
        onCancel={() => setPendingFiles(null)}
      />
    </div>
  );
};

export default CreateReviewPage;
