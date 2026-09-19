/**
 * ドキュメント処理モジュールのエントリポイント
 */
import { S3Client } from "@aws-sdk/client-s3";
import { splitPdfPages } from "./split-pages";
import { ProcessDocumentResult } from "../common/types";
import { makePrismaCheckRepository } from "../../api/features/checklist/domain/repository";
import { CHECK_LIST_STATUS } from "../../api/features/checklist/domain/model/checklist";

/**
 * テキストとして取り込めるファイル。
 * 変換は review-item-processor の office_documents が行う
 */
export const OFFICE_FILE_EXTENSIONS = ["xlsx", "docx", "pptx"];

export interface ProcessDocumentParams {
  documentId: string;
  fileName: string;
}

/**
 * ドキュメントを処理する
 * @param params ドキュメント処理パラメータ
 * @returns 処理結果
 */
export async function processDocument({
  documentId,
  fileName,
}: ProcessDocumentParams): Promise<ProcessDocumentResult> {
  // ドキュメントステータスを処理中に更新
  const checkRepository = await makePrismaCheckRepository();
  await checkRepository.updateDocumentStatus({
    documentId,
    status: CHECK_LIST_STATUS.PROCESSING,
  });

  const fileExtension = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Office ファイルは中身が XML なので、画像にせずテキストにできる。
  // 変換器は Python 側にあるので、ここでは変換が要ることだけを伝えて戻る
  if (OFFICE_FILE_EXTENSIONS.includes(fileExtension)) {
    return {
      documentId,
      pageCount: 0,
      pages: [],
      pageFormat: "md",
      needsOfficeConversion: true,
    };
  }

  if (fileExtension !== "pdf") {
    throw new Error(`サポートされていないファイル形式です: ${fileExtension}`);
  }

  const s3Client = new S3Client({});
  const bucketName = process.env.DOCUMENT_BUCKET || "";

  // PDFをページに分割
  const pageCount = await splitPdfPages(
    s3Client,
    bucketName,
    documentId,
    fileName
  );

  // 各ページの情報を返す
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1,
  }));

  return {
    documentId,
    pageCount,
    pages,
    pageFormat: "pdf",
    needsOfficeConversion: false,
  };
}
