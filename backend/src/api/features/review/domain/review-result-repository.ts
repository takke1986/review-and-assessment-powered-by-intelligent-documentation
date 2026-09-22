import { getPrismaClient, PrismaClient } from "../../../core/db";
import { NotFoundError } from "../../../core/errors";
import {
  ReviewResultEntity,
  ReviewResultDetail,
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  ReviewResultDomain,
} from "./model/review";
import {
  CHECK_ITEM_IMPORTANCE,
  DEFAULT_CHECK_ITEM_IMPORTANCE,
  parseCheckItemImportance,
} from "../../checklist/domain/model/checklist";

/**
 * 審査結果の読み書き。
 *
 * ジョブの読み書き（repository.ts）とは別にしてある。同じ1つのファイルに
 * 置いていたら 970 行を超え、どちらを触っているのか見失いやすくなっていた
 */

export interface ReviewResultRepository {
  findDetailedReviewResultById(params: {
    resultId: string;
  }): Promise<ReviewResultDetail>;
  findReviewResultsById(params: {
    jobId: string;
    parentId?: string;
    filter?: REVIEW_RESULT;
    includeAllChildren?: boolean;
    importance?: CHECK_ITEM_IMPORTANCE;
  }): Promise<ReviewResultDetail[]>;
  updateResult(params: { newResult: ReviewResultEntity }): Promise<void>;
  bulkUpdateResults(params: { results: ReviewResultEntity[] }): Promise<void>;
}

export const makePrismaReviewResultRepository = async (
  clientInput: PrismaClient | null = null
): Promise<ReviewResultRepository> => {
  const client = clientInput || (await getPrismaClient());
  const findDetailedReviewResultById = async (params: {
    resultId: string;
  }): Promise<ReviewResultDetail> => {
    const { resultId } = params;

    // 1) 対象の ReviewResult と紐づく CheckList を取得
    const result = await client.reviewResult.findUnique({
      where: { id: resultId },
      include: {
        // 使うのは6列だけ。全列だと着眼点やフィードバック要約（Text）まで
        // 結果1件ごとに運ぶことになる
        checkList: {
          select: {
            id: true,
            checkListSetId: true,
            name: true,
            description: true,
            parentId: true,
            importance: true,
          },
        },
        previousResult: { select: ReviewResultDomain.previousResultSelect },
      },
    });

    if (!result) {
      throw new Error(`ReviewResult not found: ${resultId}`);
    }

    // 2) 同じジョブ内で、このチェック項目に対する子結果があるかをカウント
    const childCount = await client.reviewResult.count({
      where: {
        reviewJobId: result.reviewJobId,
        checkList: {
          parentId: result.checkId,
        },
      },
    });

    // 3) ドメインモデルにマッピングして返却
    return ReviewResultDomain.fromPrismaReviewResultDetail(
      result,
      childCount > 0
    );
  };

  const findReviewResultsById = async (params: {
    jobId: string;
    parentId?: string;
    filter?: REVIEW_RESULT;
    includeAllChildren: boolean;
    importance?: CHECK_ITEM_IMPORTANCE;
  }): Promise<ReviewResultDetail[]> => {
    const { jobId, parentId, filter, includeAllChildren, importance } = params;

    console.log(
      `[Repository] findReviewResultsById - jobId: ${jobId}, parentId: ${
        parentId || "null"
      }, filter: ${filter || "all"}, includeAllChildren: ${includeAllChildren}`
    );

    // クエリの基本条件を構築
    const whereCondition: any = {
      reviewJobId: jobId,
    };

    // includeAllChildrenがfalseの場合のみ、parentIdの条件を適用
    if (!includeAllChildren) {
      whereCondition.checkList = {
        parentId: parentId || null,
      };
    }

    // 重要度で絞り込むときも、子を持つ項目は配下を開けるように常に返す
    if (importance) {
      whereCondition.AND = [
        {
          checkList: {
            OR: [{ children: { some: {} } }, { importance }],
          },
        },
      ];
    }

    // 合否で絞り込むときも、子を持つ項目は配下を開けるように常に返す。
    // 親の判定は子から導いた値なので、子が合格・不合格の混在だと親は不合格になり、
    // 「合格」で絞ると親ごと消えて、合格の子にたどり着けなくなる。
    if (filter) {
      whereCondition.AND = [
        ...(whereCondition.AND ?? []),
        {
          OR: [
            { checkList: { children: { some: {} } } },
            { status: REVIEW_RESULT_STATUS.COMPLETED, result: filter },
          ],
        },
      ];
    }

    // 審査結果を取得
    const results = await client.reviewResult.findMany({
      where: whereCondition,
      include: {
        // 使うのは6列だけ。全列だと着眼点やフィードバック要約（Text）まで
        // 結果1件ごとに運ぶことになる
        checkList: {
          select: {
            id: true,
            checkListSetId: true,
            name: true,
            description: true,
            parentId: true,
            importance: true,
          },
        },
        previousResult: { select: ReviewResultDomain.previousResultSelect },
      },
      orderBy: {
        checkId: "asc",
      },
    });

    console.log(`[Repository] Found ${results.length} results`);


    if (results.length === 0) {
      return [];
    }

    // 子要素の有無を一括確認
    const checkIds = results.map((result) => result.checkId);

    console.log(
      `[Repository] Checking for children of ${checkIds.length} checkIds`
    );

    // すべてのチェックIDに対する子の存在を一度に確認する
    // まず、jobIdに関連するすべての結果を取得し、checkListのparentIdがcheckIdsに含まれるものを選択
    const childResults = await client.reviewResult.findMany({
      where: {
        reviewJobId: jobId,
        checkList: {
          parentId: {
            in: checkIds,
          },
        },
      },
      select: {
        checkList: {
          select: {
            parentId: true,
          },
        },
      },
    });

    console.log(`[Repository] Found ${childResults.length} child results`);

    // 子を持つ親IDのセットを作成
    const parentsWithChildren = new Set(
      childResults.map((child) => child.checkList.parentId)
    );

    // 結果を新しいモデル形式に変換して返す
    const mappedResults = results.map((result) => {
      const baseEntity = ReviewResultDomain.fromPrismaReviewResult(result);

      return {
        ...baseEntity,
        checkList: {
          id: result.checkList.id,
          setId: result.checkList.checkListSetId,
          name: result.checkList.name,
          description: result.checkList.description || undefined,
          parentId: result.checkList.parentId || undefined,
          importance:
            parseCheckItemImportance(result.checkList.importance) ??
            DEFAULT_CHECK_ITEM_IMPORTANCE,
        },
        hasChildren: parentsWithChildren.has(result.checkId),
        previousResult: ReviewResultDomain.toPreviousResult(
          result.previousResult
        ),
      };
    });

    return mappedResults;
  };

  const updateResult = async (params: {
    newResult: ReviewResultEntity;
  }): Promise<void> => {
    const { newResult } = params;

    console.log(
      "[updateResult] extractedText type:",
      typeof newResult.extractedText,
      "value:",
      newResult.extractedText
    );

    await client.reviewResult.update({
      where: { id: newResult.id },
      data: {
        status: newResult.status,
        result: newResult.result,
        confidenceScore: newResult.confidenceScore,
        explanation: newResult.explanation,
        shortExplanation: newResult.shortExplanation,
        extractedText: newResult.extractedText
          ? (JSON.stringify(newResult.extractedText) as any)
          : undefined,
        userOverride: newResult.userOverride,
        userComment: newResult.userComment,
        // undefined は Prisma では「変えない」なので、消したいときは null を渡す。
        // 審査し直したら前回覆された理由は消えてほしい
        aiResult: newResult.aiResult ?? null,
        overrideReason: newResult.overrideReason ?? null,
        overriddenBy: newResult.overriddenBy ?? null,
        overriddenAt: newResult.overriddenAt ?? null,
        updatedAt: newResult.updatedAt,
        sourceReferences: newResult.sourceReferences
          ? JSON.stringify(newResult.sourceReferences)
          : undefined,
        externalSources: newResult.externalSources
          ? JSON.stringify(newResult.externalSources)
          : undefined,
        reviewMeta: newResult.reviewMeta,
        inputTokens: newResult.inputTokens,
        outputTokens: newResult.outputTokens,
        totalCost: newResult.totalCost,
      },
    });
  };

  const bulkUpdateResults = async (params: {
    results: ReviewResultEntity[];
  }): Promise<void> => {
    const { results } = params;

    await client.$transaction(async (tx) => {
      for (const result of results) {
        await tx.reviewResult.update({
          where: { id: result.id },
          data: {
            status: result.status,
            result: result.result,
            confidenceScore: result.confidenceScore,
            explanation: result.explanation,
            shortExplanation: result.shortExplanation,
            extractedText: result.extractedText
              ? (JSON.stringify(result.extractedText) as any)
              : undefined,
            userOverride: result.userOverride,
            userComment: result.userComment,
            aiResult: result.aiResult ?? null,
            overrideReason: result.overrideReason ?? null,
            overriddenBy: result.overriddenBy ?? null,
            overriddenAt: result.overriddenAt ?? null,
            updatedAt: result.updatedAt,
            sourceReferences: result.sourceReferences
              ? JSON.stringify(result.sourceReferences)
              : undefined,
            externalSources: result.externalSources
              ? JSON.stringify(result.externalSources)
              : undefined,
            reviewMeta: result.reviewMeta,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalCost: result.totalCost,
          },
        });
      }
    });
  };

  return {
    findDetailedReviewResultById,
    findReviewResultsById,
    updateResult,
    bulkUpdateResults,
  };
};
