import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import DocumentPreview from "../../../components/DocumentPreview";
import { ReviewJobDocument, ReviewJobLink } from "../types";

export interface ReviewJobDocumentsProps {
  documents: ReviewJobDocument[];
  /** 再審査の元になったジョブ。あれば、その文書を差し替え前として並べる */
  sourceJob?: ReviewJobLink & { documents?: ReviewJobDocument[] };
}

const DocumentList = ({
  documents,
  labelFor,
}: {
  documents: ReviewJobDocument[];
  /** 文書ごとの区分（引き継ぎ・差し替え・追加・外した） */
  labelFor?: (doc: ReviewJobDocument) => string | undefined;
}) => {
  const { t } = useTranslation();

  if (documents.length === 0) {
    return (
      <p className="text-sm text-aws-font-color-gray">
        {t("review.noDocuments")}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {documents.map((doc) => {
        const label = labelFor?.(doc);
        return (
          <li key={doc.id} className="text-sm">
            <div className="flex items-center gap-2">
              {label && (
                <span className="rounded-full bg-light-gray px-2 py-0.5 text-xs text-aws-squid-ink-light">
                  {label}
                </span>
              )}
              <DocumentPreview s3Key={doc.s3Path} filename={doc.filename} />
            </div>
            {/* 修正版は同じ名前で上げることが多いので、名前だけでは区別できない */}
            {doc.uploadDate && (
              <p className="text-xs text-aws-font-color-gray">
                {t("review.uploadedAt", {
                  date: new Date(doc.uploadDate).toLocaleString(),
                })}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/**
 * 審査した文書の一覧。再審査のジョブでは、差し替え前（元のジョブ）と
 * 差し替え後（このジョブ）の文書を並べ、文書ごとに引き継ぎ・差し替え・
 * 追加・外したのどれかを示す。
 */
export default function ReviewJobDocuments({
  documents,
  sourceJob,
}: ReviewJobDocumentsProps) {
  const { t } = useTranslation();

  if (!sourceJob?.documents) {
    return (
      <div className="mb-6 rounded-lg border border-light-gray bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-medium text-aws-squid-ink-light">
          {t("review.jobDocuments")}
        </h2>
        <DocumentList documents={documents} />
      </div>
    );
  }

  const sourceById = new Map(sourceJob.documents.map((doc) => [doc.id, doc]));

  const afterLabel = (doc: ReviewJobDocument) => {
    if (doc.carriedFromDocumentId) return t("review.documentKept");
    if (doc.replacesDocumentId) {
      const replaced = sourceById.get(doc.replacesDocumentId);
      return replaced
        ? t("review.documentReplaces", { filename: replaced.filename })
        : t("review.documentReplaced");
    }
    return t("review.documentAdded");
  };

  const beforeLabel = (doc: ReviewJobDocument) => {
    if (documents.some((after) => after.carriedFromDocumentId === doc.id)) {
      return t("review.documentKept");
    }
    if (documents.some((after) => after.replacesDocumentId === doc.id)) {
      return t("review.documentReplaced");
    }
    return t("review.documentRemoved");
  };

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg border border-light-gray bg-white p-4 shadow-sm md:grid-cols-2">
      <div>
        <h2 className="font-medium text-aws-squid-ink-light">
          {t("review.documentsBefore")}
        </h2>
        <p className="mb-2 text-xs text-aws-font-color-gray">
          <Link
            to={`/review/${sourceJob.id}`}
            className="text-aws-font-color-blue hover:underline">
            {sourceJob.name}
          </Link>
        </p>
        <DocumentList documents={sourceJob.documents} labelFor={beforeLabel} />
      </div>
      <div>
        <h2 className="font-medium text-aws-squid-ink-light">
          {t("review.documentsAfter")}
        </h2>
        <p className="mb-2 text-xs text-aws-font-color-gray">
          {t("review.thisJob")}
        </p>
        <DocumentList documents={documents} labelFor={afterLabel} />
      </div>
    </div>
  );
}
