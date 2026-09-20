import { FastifyInstance } from "fastify";
import {
  createReviewJobHandler,
  deleteReviewDocumentHandler,
  deleteReviewJobHandler,
  getAllReviewJobsHandler,
  getReviewCostSummaryHandler,
  setReviewJobSharingHandler,
  getReviewJobByIdHandler,
  getReviewPresignedUrlHandler,
  getReviewDocumentsPresignedUrlHandler,
  getReviewImagesPresignedUrlHandler,
  getReviewResultItemsHandler,
  overrideReviewResultHandler,
  getDownloadPresignedUrlHandler,
} from "./handlers";

/**
 * 審査機能のルート登録
 * @param fastify Fastifyインスタンス
 */
export function registerReviewRoutes(fastify: FastifyInstance): void {
  // 審査ドキュメント関連
  fastify.post("/documents/review/presigned-url", {
    handler: getReviewPresignedUrlHandler,
  });
  fastify.post("/documents/review/documents/presigned-url", {
    handler: getReviewDocumentsPresignedUrlHandler,
  });
  fastify.post("/documents/review/images/presigned-url", {
    handler: getReviewImagesPresignedUrlHandler,
  });
  fastify.delete("/documents/review/:key", {
    handler: deleteReviewDocumentHandler,
  });
  // ダウンロード用Presigned URL取得エンドポイント
  fastify.get("/documents/download-url", {
    handler: getDownloadPresignedUrlHandler,
  });

  // 費用の内訳。Fastify は :id より静的な区間を優先するので、
  // cost-summary がジョブIDとして拾われることはない
  fastify.get("/review-jobs/cost-summary", {
    handler: getReviewCostSummaryHandler,
  });

  // 審査ジョブ関連
  fastify.get("/review-jobs", {
    handler: getAllReviewJobsHandler,
  });
  // 社内への公開の切り替え。切り替えられるのは作成者だけ
  fastify.put("/review-jobs/:jobId/sharing", {
    handler: setReviewJobSharingHandler,
  });

  fastify.get("/review-jobs/:jobId", {
    handler: getReviewJobByIdHandler,
  });
  fastify.post("/review-jobs", {
    handler: createReviewJobHandler,
  });
  fastify.delete("/review-jobs/:jobId", {
    handler: deleteReviewJobHandler,
  });

  // 審査結果関連
  fastify.get("/review-jobs/:jobId/results/items", {
    handler: getReviewResultItemsHandler,
  });
  fastify.put("/review-jobs/:jobId/results/:resultId", {
    handler: overrideReviewResultHandler,
  });
}
