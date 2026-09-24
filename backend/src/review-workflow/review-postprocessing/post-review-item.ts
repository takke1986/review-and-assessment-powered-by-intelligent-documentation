import { makePrismaReviewJobRepository } from "../../api/features/review/domain/repository";
import { makePrismaReviewResultRepository } from "../../api/features/review/domain/review-result-repository";
import {
  REVIEW_FILE_TYPE,
  REVIEW_RESULT,
  ReviewResultDomain,
} from "../../api/features/review/domain/model/review";
import { S3TempStorage } from "../../utils/s3-temp";
import { getS3Client } from "../../api/core/s3";
import { selectSourceDocuments } from "./source-documents";

// TypeScript declaration for console
declare const console: {
  log: (...data: any[]) => void;
  error: (...data: any[]) => void;
};

/**
 * Function to convert snake_case keys to camelCase in an object
 * @param obj Object to convert
 * @returns Object with keys converted to camelCase
 */
function convertSnakeToCamelCase(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertSnakeToCamelCase(item));
  }

  return Object.keys(obj).reduce(
    (result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      result[camelKey] = convertSnakeToCamelCase(obj[key]);
      return result;
    },
    {} as Record<string, any>
  );
}

/**
 * Review item post-processing parameters
 */
export interface PostReviewItemParams {
  reviewJobId: string;
  checkId: string;
  reviewResultId: string;
  documentIds: string[];
  reviewData: any; // Results from Python Lambda
}

/** 判定を "pass" か "fail" にそろえる。読めないものは不合格 */
export const normalizeVerdict = (raw: unknown): REVIEW_RESULT => {
  const verdict = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return verdict === REVIEW_RESULT.PASS
    ? REVIEW_RESULT.PASS
    : REVIEW_RESULT.FAIL;
};

/**
 * Process the review result from MCP and store in database
 * @param params Processing parameters
 * @returns Processing result
 */
export async function postReviewItemProcessor(
  params: PostReviewItemParams
): Promise<any> {
  const { reviewJobId, checkId, reviewResultId, documentIds, reviewData } =
    params;

  console.log(`[DEBUG POST] Processing review result for ${reviewResultId}`);

  try {
    // 🎯 S3参照から実データを復元
    const s3TempStorage = new S3TempStorage(
      getS3Client(),
      process.env.TEMP_BUCKET || ""
    );
    const resolvedReviewData = await s3TempStorage.resolve(reviewData);
    // Get the current review result
    const reviewResultRepository = await makePrismaReviewResultRepository();
    const current = await reviewResultRepository.findDetailedReviewResultById({
      resultId: reviewResultId,
    });

    if (!current) {
      throw new Error(`Review result not found: ${reviewResultId}`);
    }

    // 判定は "pass" / "fail" の2つだけ。画面と集計は完全一致で数えるので、
    // それ以外（"PASS"、"合格" など）をそのまま保存すると合否どちらにも出ない。
    // 審査処理の側でもそろえているが、ここでも確かめる。読めなければ不合格
    const verdict = normalizeVerdict(resolvedReviewData.result);
    if (verdict !== resolvedReviewData.result) {
      console.log(
        `[DEBUG POST] Unreadable verdict ${JSON.stringify(resolvedReviewData.result)} for ${reviewResultId}; saved as ${verdict}`
      );
    }

    // Use explicit review type from the response instead of detection
    const reviewType = resolvedReviewData.reviewType || "PDF"; // Default to PDF for backward compatibility
    console.log(`[DEBUG POST] Using explicit review type: ${reviewType}`);

    let updated;

    if (reviewType === "IMAGE") {
      // Get documents to construct the image buffers structure expected by fromImageLlmReviewData
      const reviewJobRepository = await makePrismaReviewJobRepository();
      const jobDetail = await reviewJobRepository.findReviewJobById({
        reviewJobId,
      });

      // Find image documents in the job
      const imageDocuments = jobDetail.documents.filter(
        (doc) => doc.fileType === REVIEW_FILE_TYPE.IMAGE
      );

      // Create placeholder image buffers with document IDs
      const imageBuffers = imageDocuments.map((doc) => ({
        documentId: doc.id,
        filename: doc.filename,
        buffer: new Uint8Array(), // Empty buffer - we don't need actual image data here
      }));

      // Handle bounding boxes
      const boundingBoxes = resolvedReviewData.boundingBoxes || [];

      console.log(
        `[DEBUG POST] Processing image review with ${imageBuffers.length} images and ${boundingBoxes.length} bounding boxes`
      );

      // Create document info array from image buffers
      const documents = imageBuffers.map((img) => ({
        documentId: img.documentId,
        filename: img.filename,
      }));

      // Convert reviewMeta from snake_case to camelCase
      if (resolvedReviewData.reviewMeta) {
        resolvedReviewData.reviewMeta = convertSnakeToCamelCase(
          resolvedReviewData.reviewMeta
        );
      }

      // Use the unified review data method
      updated = ReviewResultDomain.fromReviewData({
        current,
        result: verdict,
        // 0 も自信度として意味があるので、無いときだけ既定値にする
        confidenceScore: resolvedReviewData.confidence ?? 0.5,
        explanation: resolvedReviewData.explanation || "",
        shortExplanation: resolvedReviewData.shortExplanation || "",
        documents,
        reviewType: "IMAGE",
        typeSpecificData: {
          usedImageIndexes: resolvedReviewData.usedImageIndexes || [],
          boundingBoxes,
        },
        verificationDetails: resolvedReviewData.verificationDetails,
        reviewMeta: resolvedReviewData.reviewMeta || null,
        inputTokens: resolvedReviewData.inputTokens || null,
        outputTokens: resolvedReviewData.outputTokens || null,
        totalCost: resolvedReviewData.totalCost || null,
      });
    } else {
      // Get the job detail to access document information
      const reviewJobRepository = await makePrismaReviewJobRepository();
      const jobDetail = await reviewJobRepository.findReviewJobById({
        reviewJobId,
      });

      // 根拠にする文書。審査処理が返した sources（ファイルとページ）で絞る。
      // 種類で絞らない。文書と画像を混ぜた審査では画像も根拠になり、ここで
      // 落とすと、モデルが図面を読んで判定していても参照元に出てこない。
      // 審査に渡した分だけを見るのは documentIds が担う
      const documents = selectSourceDocuments({
        documents: jobDetail.documents,
        documentIds,
        sources: resolvedReviewData.sources,
        pageNumber: resolvedReviewData.pageNumber,
      });

      console.log(
        `[DEBUG POST] Processing PDF review with ${documents.length} documents`
      );

      // Convert reviewMeta from snake_case to camelCase
      if (resolvedReviewData.reviewMeta) {
        resolvedReviewData.reviewMeta = convertSnakeToCamelCase(
          resolvedReviewData.reviewMeta
        );
      }

      // Use the unified review data method
      updated = ReviewResultDomain.fromReviewData({
        current,
        result: verdict,
        // 0 も自信度として意味があるので、無いときだけ既定値にする
        confidenceScore: resolvedReviewData.confidence ?? 0.5,
        explanation: resolvedReviewData.explanation || "",
        shortExplanation: resolvedReviewData.shortExplanation || "",
        documents,
        reviewType: "PDF",
        typeSpecificData: {
          extractedText: resolvedReviewData.extractedText || [],
        },
        verificationDetails: resolvedReviewData.verificationDetails,
        reviewMeta: resolvedReviewData.reviewMeta || null,
        inputTokens: resolvedReviewData.inputTokens || null,
        outputTokens: resolvedReviewData.outputTokens || null,
        totalCost: resolvedReviewData.totalCost || null,
      });
    }

    // Update the result in the database
    await reviewResultRepository.updateResult({
      newResult: updated,
    });

    console.log(
      `[DEBUG POST] Updated review result to: ${resolvedReviewData.result}`
    );

    return {
      status: "success",
      reviewResultId,
      checkId,
      result: verdict,
    };
  } catch (error) {
    console.error(`[DEBUG POST] Error processing review result: ${error}`);
    throw error;
  }
}
