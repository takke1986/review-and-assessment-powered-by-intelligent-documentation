import { reviewErrorHandler } from "./handle-error";
import { recordReading } from "./review-reading/record-reading";
import { prepareReview, finalizeReview } from "./review-processing";
import { preReviewItemProcessor } from "./review-preprocessing/pre-review-item";
import { postReviewItemProcessor } from "./review-postprocessing/post-review-item";

export const handler = async (event: any): Promise<any> => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  // アクションタイプに基づいて処理を分岐
  switch (event.action) {
    case "prepareReview":
      return await handlePrepareReview(event);
    case "finalizeReview":
      return await handleFinalizeReview(event);
    case "handleReviewError":
      return await handleReviewError(event);
    case "recordReading":
      return await handleRecordReading(event);
    case "preReviewItemProcessor":
      return await preReviewItemProcessor(event);
    case "postReviewItemProcessor":
      return await postReviewItemProcessor(event);
    default:
      throw new Error(`未知のアクション: ${event.action}`);
  }
};

/**
 * 審査準備ハンドラー
 */
async function handlePrepareReview(event: any) {
  return await prepareReview({
    reviewJobId: event.reviewJobId,
    executionArn: event.executionArn,
  });
}

/**
 * 審査結果集計ハンドラー
 */
async function handleFinalizeReview(event: any) {
  return await finalizeReview({
    reviewJobId: event.reviewJobId,
    processedItems: event.processedItems,
  });
}

/**
 * 読み取り結果の対応を残すハンドラー。
 *
 * 読み取りは審査の補助なので、ここで落ちても審査は止めない。記録が無い
 * ままでも審査はできる（S3 の中身はある）ので、失敗は残して先へ進む。
 */
async function handleRecordReading(event: any) {
  try {
    return await recordReading({
      reviewJobId: event.reviewJobId,
      records: event.records || [],
    });
  } catch (error) {
    console.error("読み取り結果を残せなかった:", error);
    return { recorded: 0, skipped: [], error: String(error) };
  }
}

/**
 * エラーハンドリングハンドラー
 */
async function handleReviewError(event: any) {
  await reviewErrorHandler(event);
}
