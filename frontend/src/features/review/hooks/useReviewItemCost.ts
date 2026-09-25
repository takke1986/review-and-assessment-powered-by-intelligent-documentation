import { useMemo } from "react";
import { ReviewResultDetail } from "../types";

interface ReviewItemCostResult {
  hasCost: boolean;
  cost: number;
  formattedCost: string;
  details?: {
    inputTokens: number;
    outputTokens: number;
    modelId: string;
  };
}

/**
 * 審査項目の料金情報を扱うフック
 *
 * @param item 審査結果アイテム
 * @returns 料金情報の計算結果
 */
export function useReviewItemCost(
  item: ReviewResultDetail
): ReviewItemCostResult {
  return useMemo(() => {
    // 料金データの取得と計算
    const cost = item.totalCost || item.reviewMeta?.total_cost || 0;
    const hasCost = cost > 0;

    if (!hasCost) {
      return {
        hasCost: false,
        cost: 0,
        formattedCost: "",
      };
    }

    const formattedCost = `$${cost.toFixed(4)}`;

    const details = item.reviewMeta
      ? {
          inputTokens: item.inputTokens || item.reviewMeta.input_tokens || 0,
          outputTokens: item.outputTokens || item.reviewMeta.output_tokens || 0,
          // 保存の前に camelCase に直されている（types.ts の reviewMeta を参照）
          modelId: item.reviewMeta.modelId ?? item.reviewMeta.model_id,
        }
      : undefined;

    return {
      hasCost: true,
      cost,
      formattedCost,
      details,
    };
  }, [item.totalCost, item.reviewMeta, item.inputTokens, item.outputTokens]);
}
