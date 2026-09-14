import { useTranslation } from "react-i18next";
import { ReviewJobDocument } from "../types";

export interface RerunDocumentPickerProps {
  /** 元のジョブの文書 */
  sourceDocuments: ReviewJobDocument[];
  /** 引き継ぐ元の文書 */
  keptIds: Set<string>;
  onToggleKeep: (sourceDocumentId: string) => void;
  /** このジョブにアップロードした文書 */
  uploadedDocuments: Array<{ documentId: string; filename: string }>;
  /** アップロードした文書ごとの差し替え対象（空文字は追加） */
  replacements: Record<string, string>;
  onChangeReplacement: (uploadedDocumentId: string, sourceId: string) => void;
}

/**
 * 再審査で、元のジョブの文書をどう扱うかを選ぶ。
 *
 * 元の文書は最初はすべて引き継ぐ。修正版をアップロードしたら、どの文書の
 * 差し替えかを選ぶ。差し替えた文書は引き継がれず、選ばなければ追加になる。
 */
export default function RerunDocumentPicker({
  sourceDocuments,
  keptIds,
  onToggleKeep,
  uploadedDocuments,
  replacements,
  onChangeReplacement,
}: RerunDocumentPickerProps) {
  const { t } = useTranslation();

  const replacedBy = new Map<string, string>();
  for (const doc of uploadedDocuments) {
    const sourceId = replacements[doc.documentId];
    if (sourceId) {
      replacedBy.set(sourceId, doc.filename);
    }
  }

  const formatDate = (date?: Date) =>
    date ? new Date(date).toLocaleString() : "";

  return (
    <div className="rounded-md border border-light-gray bg-white p-4 shadow-sm dark:bg-aws-squid-ink-dark">
      <h3 className="text-lg font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
        {t("review.rerunDocuments")}
      </h3>
      <p className="mt-1 text-sm text-aws-font-color-gray">
        {t("review.rerunDocumentsHelp")}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
            {t("review.sourceDocuments")}
          </h4>
          <ul className="space-y-2">
            {sourceDocuments.map((doc) => {
              const replacement = replacedBy.get(doc.id);
              return (
                <li key={doc.id} className="text-sm">
                  <div className="flex items-start gap-2">
                    {replacement ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                        {t("review.documentReplacedBy", {
                          filename: replacement,
                        })}
                      </span>
                    ) : (
                      <label className="flex cursor-pointer items-center gap-1">
                        <input
                          type="checkbox"
                          checked={keptIds.has(doc.id)}
                          onChange={() => onToggleKeep(doc.id)}
                        />
                        <span className="text-xs text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
                          {keptIds.has(doc.id)
                            ? t("review.keepDocument")
                            : t("review.documentRemoved")}
                        </span>
                      </label>
                    )}
                    <span className="text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
                      {doc.filename}
                    </span>
                  </div>
                  <p className="text-xs text-aws-font-color-gray">
                    {t("review.uploadedAt", { date: formatDate(doc.uploadDate) })}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h4 className="mb-2 font-medium text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
            {t("review.uploadedDocumentsForRerun")}
          </h4>
          {uploadedDocuments.length === 0 ? (
            <p className="text-sm text-aws-font-color-gray">
              {t("review.noUploadsYet")}
            </p>
          ) : (
            <ul className="space-y-2">
              {uploadedDocuments.map((doc) => {
                const selected = replacements[doc.documentId] ?? "";
                const taken = new Set(
                  uploadedDocuments
                    .filter((other) => other.documentId !== doc.documentId)
                    .map((other) => replacements[other.documentId])
                    .filter(Boolean)
                );
                return (
                  <li key={doc.documentId} className="text-sm">
                    <p className="text-aws-squid-ink-light dark:text-aws-font-color-white-dark">
                      {doc.filename}
                    </p>
                    <label className="mt-1 flex items-center gap-2 text-xs text-aws-font-color-gray">
                      {t("review.replacementTarget")}
                      <select
                        className="rounded border border-light-gray px-2 py-1 text-sm text-aws-squid-ink-light"
                        value={selected}
                        onChange={(e) =>
                          onChangeReplacement(doc.documentId, e.target.value)
                        }>
                        <option value="">{t("review.replacementNone")}</option>
                        {sourceDocuments.map((source) => (
                          <option
                            key={source.id}
                            value={source.id}
                            disabled={taken.has(source.id)}>
                            {source.filename}（{formatDate(source.uploadDate)}）
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
