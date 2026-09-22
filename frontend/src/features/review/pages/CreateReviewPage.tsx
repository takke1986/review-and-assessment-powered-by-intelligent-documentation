import React, { useEffect, useRef, useState } from "react";
import {
  IMAGE_EXTENSIONS,
  OFFICE_FILE_TYPES,
  isImageFileName,
} from "../../../utils/officeFiles";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Button from "../../../components/Button";
import PageHeader from "../../../components/PageHeader";
import FormTextField from "../../../components/FormTextField";
import DepartmentPicker, { useDepartmentChoice } from "../../../components/DepartmentPicker";
import { FormTextArea } from "../../../components/FormTextArea";
import { FileUploader } from "../../../components/FileUploader";
import ChecklistSelector from "../components/ChecklistSelector";
import ComparisonIndicator from "../components/ComparisonIndicator";
import DuplicateFileModal from "../components/DuplicateFileModal";
import CheckItemPicker from "../components/CheckItemPicker";
import RerunDocumentPicker from "../components/RerunDocumentPicker";
import RerunSourcePanel from "../components/RerunSourcePanel";
import { useCreateReviewJob } from "../hooks/useReviewJobMutations";
import { requestNotificationPermission } from "../hooks/useJobCompletionNotice";
import { useRerunSource } from "../hooks/useRerunSource";
import { endedEarly } from "../reviewJobRules";
import { useRerunDocuments } from "../hooks/useRerunDocuments";
import { useReviewFileSelection } from "../hooks/useReviewFileSelection";
import { useDocumentUpload } from "../../../hooks/useDocumentUpload";
import { useChecklistSets } from "../../checklist/hooks/useCheckListSetQueries";
import {
  CHECK_LIST_STATUS,
  CheckListSetSummary,
} from "../../checklist/types";
import {
  HiExclamationCircle,
} from "react-icons/hi";
import { REVIEW_FILE_TYPE } from "../types";
import { MAX_REVISION_NOTE_LENGTH } from "../../../constants/index";

export const CreateReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // 再審査: ?source=<ジョブID> で開くと、そのジョブで不合格だった項目を
  // 差し替えた文書で審査し直す。選ばなかった項目は元の結果を引き継ぐ
  const [searchParams] = useSearchParams();
  const sourceJobId = searchParams.get("source");
  const { sourceJob, failedCheckIds, failedCheckIdSet } =
    useRerunSource(sourceJobId);
  const [selectedChecklist, setSelectedChecklist] =
    useState<CheckListSetSummary | null>(null);
  // 審査するチェック項目（子を持たない項目のID）と、選べる項目の数。
  // 項目の読み込みが終わるまでは null
  const [checkSelection, setCheckSelection] = useState<{
    ids: Set<string>;
    total: number;
  } | null>(null);
  const [jobName, setJobName] = useState("");
  // どの部署の仕事として記録するか。所属が1つならサーバが決めるので、
  // 選ばせるのは兼務の人だけ
  const { mustChoose } = useDepartmentChoice();
  const [departmentId, setDepartmentId] = useState("");
  // 再審査で何を直したかのメモ（任意）
  const [revisionNote, setRevisionNote] = useState("");
  const isRevisionNoteTooLong =
    revisionNote.trim().length > MAX_REVISION_NOTE_LENGTH;
  const [checklistPage, setChecklistPage] = useState(1);
  const [checklistSearch, setChecklistSearch] = useState("");
  const [checklistLimit] = useState(5);
  const [errors, setErrors] = useState({
    name: "",
    files: "",
    department: "",
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
    CHECK_LIST_STATUS.COMPLETED,
    checklistSearch
  );

  // 絞り込むと件数が減るので、ページを戻さないと空のページを見ることになる
  const handleChecklistSearchChange = (value: string) => {
    setChecklistSearch(value);
    setChecklistPage(1);
  };

  // 審査ジョブ作成フック
  const { createReviewJob, status, error: createError } = useCreateReviewJob();
  const isSubmitting = status === "loading";

  // ドキュメントアップロードフック
  const upload = useDocumentUpload({
    presignedUrlEndpoint: "/documents/review/presigned-url",
    documentsPresignedUrlEndpoint: "/documents/review/documents/presigned-url",
    imagesPresignedUrlEndpoint: "/documents/review/images/presigned-url",
    deleteEndpointPrefix: "/documents/review/",
  });
  const {
    clearUploadedDocuments,
    isUploading,
    error: uploadError,
    uploadedDocuments,
  } = upload;

  const fileSelection = useReviewFileSelection({
    upload,
    setFilesError: (message) =>
      setErrors((prev) => ({
        ...prev,
        files: message,
      })),
    onUploaded: (files) => {
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
    },
  });

  const rerunDocuments = useRerunDocuments({ sourceJob, uploadedDocuments });

  // 再審査では元のジョブのチェックリストを使う
  const checkListSetId = sourceJobId
    ? (sourceJob?.checkList.id ?? null)
    : (selectedChecklist?.id ?? null);

  // 再審査のジョブ名の初期値（利用者が入力していれば変えない）
  const jobNameInitialized = useRef(false);
  useEffect(() => {
    if (!sourceJob || jobNameInitialized.current) {
      return;
    }
    jobNameInitialized.current = true;
    setJobName(
      (name) => name || `${sourceJob.name}${t("review.rerunJobNameSuffix")}`
    );
  }, [sourceJob, t]);

  const documentCount =
    uploadedDocuments.length + rerunDocuments.keptDocumentIds.length;

  // ファイルが選択されチェックリストも選択されているかチェック
  const isReady =
    documentCount > 0 &&
    checkListSetId !== null &&
    (checkSelection?.ids.size ?? 0) > 0 &&
    !isRevisionNoteTooLong &&
    jobName.trim() !== "";

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

  // チェックリスト選択ハンドラ
  const handleChecklistSelect = (checklist: CheckListSetSummary) => {
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
      department: "",
    };

    if (!jobName.trim()) {
      newErrors.name = t("review.nameRequired");
    }

    if (documentCount === 0) {
      newErrors.files = t("review.fileRequired");
    }

    // 兼務の人が選ばないまま進むと、部署の付かない審査になり、
    // 同僚の履歴に出てこない
    if (mustChoose && !departmentId) {
      newErrors.department = t("review.departmentRequired");
    }

    setErrors(newErrors);
    return !Object.values(newErrors).some((error) => error);
  };

  // フォーム送信ハンドラ
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate() || !checkListSetId) {
      return;
    }

    // 審査は数分かかる。始めるこの操作をきっかけに、終了を知らせる許可を求める
    await requestNotificationPermission();

    try {
      // すべてのドキュメントを同じ構造で扱う
      const documents = uploadedDocuments.map((doc) => ({
        id: doc.documentId,
        filename: doc.filename,
        s3Key: doc.s3Key,
        // 種類はファイル名から決める。文書と画像を混ぜて審査できるようにするため
        fileType: isImageFileName(doc.filename)
          ? REVIEW_FILE_TYPE.IMAGE
          : REVIEW_FILE_TYPE.PDF,
        replacesDocumentId: sourceJobId
          ? rerunDocuments.replacements[doc.documentId] || undefined
          : undefined,
      }));

      await createReviewJob({
        name: jobName,
        checkListSetId,
        // 兼務でないときは送らない。サーバが所属から決める
        departmentId: departmentId || undefined,
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
        keptDocumentIds: sourceJobId
          ? rerunDocuments.keptDocumentIds
          : undefined,
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

          <DepartmentPicker
            value={departmentId}
            onChange={setDepartmentId}
            error={errors.department}
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
                files={fileSelection.selectedFiles}
                onFilesChange={fileSelection.handleFilesChange}
                isUploading={isUploading}
                multiple={true}
                uploadedDocuments={uploadedDocuments}
                isFileUploaded={fileSelection.isFileUploaded}
                onDeleteFile={fileSelection.handleFileRemove}
                fillHeight
                acceptedFileTypes={{
                  "application/pdf": [".pdf"],
                  ...OFFICE_FILE_TYPES,
                  "image/*": IMAGE_EXTENSIONS,
                }}
                sizeLimitLabel={t("review.fileSizeLimit")}
              />
            </div>

            {/* 中央: 比較アイコン */}
            <div className="flex items-center justify-center py-4 lg:col-span-1">
              <ComparisonIndicator isReady={isReady} />
            </div>

            {/* 右側: チェックリスト選択（再審査では元のジョブを表示） */}
            <div className="lg:col-span-3">
              {sourceJobId ? (
                <RerunSourcePanel sourceJob={sourceJob} />
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
                  search={checklistSearch}
                  onSearchChange={handleChecklistSearchChange}
                />
              )}
            </div>
          </div>

          {/* 再審査: 元のジョブの文書を引き継ぐか、差し替えるか */}
          {sourceJob && rerunDocuments.keptSourceDocumentIds && (
            <div className="mt-6">
              <RerunDocumentPicker
                sourceDocuments={sourceJob.documents}
                keptIds={rerunDocuments.keptSourceDocumentIds}
                onToggleKeep={rerunDocuments.toggleKept}
                uploadedDocuments={uploadedDocuments}
                replacements={rerunDocuments.replacements}
                onChangeReplacement={rerunDocuments.setReplacement}
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
                  // 途中で終わった審査では、選ばれるのが「不合格」ではなく
                  // 「まだ審査していない項目」なので、説明を変える
                  !sourceJobId
                    ? undefined
                    : sourceJob && endedEarly(sourceJob.status)
                      ? t("review.resumeSelectionHelp")
                      : t("review.rerunSelectionHelp")
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
        isOpen={fileSelection.pendingDuplicates !== null}
        filenames={fileSelection.pendingDuplicates ?? []}
        onReplace={fileSelection.handleReplaceDuplicates}
        onKeepBoth={fileSelection.handleKeepBothDuplicates}
        onCancel={fileSelection.cancelDuplicates}
      />
    </div>
  );
};

export default CreateReviewPage;
