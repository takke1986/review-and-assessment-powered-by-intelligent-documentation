import {
  makePrismaReviewJobRepository,
} from "../../api/features/review/domain/repository";
import {
  makePrismaReviewResultRepository,
} from "../../api/features/review/domain/review-result-repository";
import {
  REVIEW_JOB_STATUS,
  REVIEW_RESULT_STATUS,
} from "../../api/features/review/domain/model/review";
import { updateCheckResultCascade } from "../../api/features/review/domain/service/review-result-cascade-update";
import { selectItemsToReview } from "./select-items";

/**
 * 審査準備パラメータ
 */
interface PrepareReviewParams {
  reviewJobId: string;
  /** この審査を動かしている実行。中止するときに使う */
  executionArn?: string;
}

/**
 * 審査結果集計パラメータ
 */
interface FinalizeReviewParams {
  reviewJobId: string;
  processedItems: any[];
}

/**
 * 審査準備処理
 * チェックリスト項目を取得し、処理項目を準備する
 */
export async function prepareReview(params: PrepareReviewParams): Promise<any> {
  const { reviewJobId, executionArn } = params;
  const reviewJobRepository = await makePrismaReviewJobRepository();
  const reviewResultRepository = await makePrismaReviewResultRepository();

  try {
    // 待ち行列にいる間に止められていたら、ここで終わる。
    // 何も見ずに「処理中」に書き換えると、止めたはずのものが動き出す
    const current = await reviewJobRepository.findReviewJobById({
      reviewJobId,
    });
    if (current.status === REVIEW_JOB_STATUS.CANCELLED) {
      console.log(`Review job was cancelled before it started: ${reviewJobId}`);
      return { reviewJobId, cancelled: true, checkItems: [] };
    }

    // 走り出してから止められるように、実行の識別子を控える
    if (executionArn) {
      await reviewJobRepository.updateJobExecution({
        reviewJobId,
        executionArn,
      });
    }

    // ジョブのステータスを処理中に更新
    await reviewJobRepository.updateJobStatus({
      reviewJobId,
      status: REVIEW_JOB_STATUS.PROCESSING,
    });

    // ジョブに関連するドキュメント情報を取得
    const jobDetail = await reviewJobRepository.findReviewJobById({
      reviewJobId,
    });

    if (!jobDetail.documents || jobDetail.documents.length === 0) {
      throw new Error(`No documents found for review job ${reviewJobId}`);
    }

    // job取得
    const results = await reviewResultRepository.findReviewResultsById({
      jobId: reviewJobId,
      includeAllChildren: true, // すべての項目を取得
    });

    // 子を持たない項目のうち、まだ完了していないものだけを処理対象とする
    const checkItems = selectItemsToReview(results);

    return {
      reviewJobId,
      documents: jobDetail.documents,
      checkItems,
    };
  } catch (error) {
    console.error(`Error preparing review job ${reviewJobId}:`, error);
    throw error;
  }
}

/**
 * 審査結果集計処理
 * 審査結果を集計し、親子関係の結果を更新する
 */
export async function finalizeReview(
  params: FinalizeReviewParams
): Promise<any> {
  const { reviewJobId, processedItems } = params;
  const reviewJobRepository = await makePrismaReviewJobRepository();
  const reviewResultRepository = await makePrismaReviewResultRepository();

  try {
    // 1. 審査結果の取得 - 空の親ID（ルート）から始める
    const results = await reviewResultRepository.findReviewResultsById({
      jobId: reviewJobId,
      includeAllChildren: true, // すべての項目を取得
    });

    if (results.length === 0) {
      throw new Error(`No review results found for job ${reviewJobId}`);
    }

    // 2. 親子関係の処理と結果更新
    // すべての子ノードについて親の結果を更新する
    for (const result of results) {
      if (result.status === REVIEW_RESULT_STATUS.COMPLETED) {
        // 更新されたノードをもとに、必要な親ノードのカスケード更新を実行
        await updateCheckResultCascade({
          updated: result,
          deps: {
            reviewResultRepo: reviewResultRepository,
          },
        });
      }
    }

    // 3. コスト計算
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const result of results) {
      const cost = result.totalCost || 0;
      const inputTokens = result.inputTokens || 0;
      const outputTokens = result.outputTokens || 0;

      if (cost > 0) {
        totalCost += cost;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
      }
    }

    // コスト情報を保存
    if (totalCost > 0) {
      await reviewJobRepository.updateJobCostInfo({
        reviewJobId,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
      });
    }

    // 4. ジョブのステータスを完了に更新
    await reviewJobRepository.updateJobStatus({
      reviewJobId,
      status: REVIEW_JOB_STATUS.COMPLETED,
    });

    return {
      status: "success",
      reviewJobId,
      message: "Review processing completed",
      costInfo: {
        totalCost,
        totalInputTokens,
        totalOutputTokens,
      },
    };
  } catch (error) {
    console.error(`Error finalizing review job ${reviewJobId}:`, error);
    throw error;
  }
}
