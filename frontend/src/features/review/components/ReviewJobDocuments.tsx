import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import DocumentPreview from "../../../components/DocumentPreview";
import { ReviewJobDocument, ReviewJobLink } from "../types";

export interface ReviewJobDocumentsProps {
  documents: ReviewJobDocument[];
  /** 再審査の元になったジョブ。あれば、その文書を差し替え前として並べる */
  sourceJob?: ReviewJobLink & { documents?: ReviewJobDocument[] };
}

const DocumentList = ({ documents }: { documents: ReviewJobDocument[] }) => {
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
      {documents.map((doc) => (
        <li key={doc.id} className="text-sm">
          <DocumentPreview s3Key={doc.s3Path} filename={doc.filename} />
          {/* 修正版は同じ名前で上げることが多いので、名前だけでは区別できない */}
          {doc.uploadDate && (
            <p className="text-xs text-aws-font-color-gray">
              {t("review.uploadedAt", {
                date: new Date(doc.uploadDate).toLocaleString(),
              })}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
};

/**
 * 審査した文書の一覧。再審査のジョブでは、差し替え前（元のジョブ）と
 * 差し替え後（このジョブ）の文書を並べて、何を入れ替えたか分かるようにする。
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
        <DocumentList documents={sourceJob.documents} />
      </div>
      <div>
        <h2 className="font-medium text-aws-squid-ink-light">
          {t("review.documentsAfter")}
        </h2>
        <p className="mb-2 text-xs text-aws-font-color-gray">
          {t("review.thisJob")}
        </p>
        <DocumentList documents={documents} />
      </div>
    </div>
  );
}
