import { getPrismaClient, PrismaClient } from "../../../core/db";
import { NotFoundError } from "../../../core/errors";
import { PaginatedResponse } from "../../../common/types";
import {
  ReviewJobEntity,
  ReviewJobSummary,
  ReviewJobDetail,
  REVIEW_JOB_STATUS,
  ReviewResultEntity,
  ReviewResultDetail,
  REVIEW_RESULT,
  REVIEW_RESULT_STATUS,
  REVIEW_FILE_TYPE,
  ReviewResultDomain,
} from "./model/review";
import {
  CHECK_LIST_STATUS,
  CHECK_ITEM_IMPORTANCE,
  DEFAULT_CHECK_ITEM_IMPORTANCE,
  parseCheckItemImportance,
} from "../../checklist/domain/model/checklist";
import { countCheckItems } from "./service/check-item-selection";
import { countReviewProgress } from "./service/review-progress";
import {
  visibilityFilter,
  type Viewer,
} from "./service/review-job-visibility";
import { summarizeCost } from "./service/review-cost-summary";

/** 期間で絞るための条件。片側だけの指定もできる */
export interface ReviewJobPeriod {
  createdFrom?: Date;
  createdTo?: Date;
}

/** 費用の集計。どこにいくら掛かっているかを見るためのもの */
export interface ReviewCostSummary {
  /** 期間全体 */
  total: {
    totalCost: number;
    jobCount: number;
    /** 1件あたり。件数が0なら0 */
    averageCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  /** 月ごと。古い順 */
  byMonth: Array<{ month: string; totalCost: number; jobCount: number }>;
  /** チェックリストごと。高い順。どの種類の審査に掛かっているかを見る */
  byChecklist: Array<{
    checkListSetId: string;
    name: string;
    totalCost: number;
    jobCount: number;
  }>;
  /** 費用の高いジョブ。突出したものを見つける */
  topJobs: Array<{
    id: string;
    name: string;
    totalCost: number;
    createdAt: Date;
  }>;
}

export interface ReviewJobRepository {
  findAllReviewJobs(params?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    status?: string;
    // ownerUserId が指定された場合、そのユーザのジョブのみ返す（管理者は未指定）
    /** 見える範囲。管理者は指定しない */
    visibleTo?: Viewer;
    /** 名前か、審査した文書の名前の一部での絞り込み */
    search?: string;
    /** このチェックリストを使ったジョブだけ */
    checkListSetId?: string;
  }): Promise<PaginatedResponse<ReviewJobSummary>>;
  summarizeReviewCost(
    params: {
      ownerUserId?: string;
      /** 月を切る時間帯。getTimezoneOffset と同じ向き */
      tzOffsetMinutes?: number;
    } & ReviewJobPeriod
  ): Promise<ReviewCostSummary>;
  findReviewJobById(params: { reviewJobId: string }): Promise<ReviewJobDetail>;
  createReviewJob(params: ReviewJobEntity): Promise<void>;
  deleteReviewJobById(params: { reviewJobId: string }): Promise<void>;
  updateJobStatus(params: {
    reviewJobId: string;
    status: REVIEW_JOB_STATUS;
    errorDetail?: string;
  }): Promise<void>;
  updateJobExecution(params: {
    reviewJobId: string;
    executionArn: string;
  }): Promise<void>;
  updateJobSharing(params: {
    reviewJobId: string;
    sharedWithOrg: boolean;
  }): Promise<void>;
  updateJobCostInfo(params: {
    reviewJobId: string;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }): Promise<void>;
}

const toReviewJobDocument = (doc: {
  id: string;
  filename: string;
  s3Path: string;
  fileType: string;
  uploadDate: Date;
  carriedFromDocumentId: string | null;
  replacesDocumentId: string | null;
}) => ({
  id: doc.id,
  filename: doc.filename,
  s3Path: doc.s3Path,
  fileType: doc.fileType as REVIEW_FILE_TYPE,
  uploadDate: doc.uploadDate,
  carriedFromDocumentId: doc.carriedFromDocumentId ?? undefined,
  replacesDocumentId: doc.replacesDocumentId ?? undefined,
});

export const makePrismaReviewJobRepository = async (
  clientInput: PrismaClient | null = null
): Promise<ReviewJobRepository> => {
  const client = clientInput || (await getPrismaClient());

  const findAllReviewJobs = async (
    params: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      status?: string;
      visibleTo?: Viewer;
      /** 名前か、審査した文書の名前の一部。増えてくると一覧から探せないため */
      search?: string;
      checkListSetId?: string;
    } = {}
  ): Promise<PaginatedResponse<ReviewJobSummary>> => {
    const {
      page = 1,
      limit = 10,
      sortBy = "id",
      sortOrder = "desc",
      status,
      search,
      checkListSetId,
    } = params;

    // WHERE条件を構築
    const whereCondition: {
      status?: string;
      checkListSetId?: string;
      OR?: Array<Record<string, unknown>>;
      AND?: Array<Record<string, unknown>>;
    } = {};
    if (status) {
      whereCondition.status = status;
    }
    const needle = search?.trim();
    if (needle) {
      // 名前だけでは探せない。ジョブ名は適当に付けられがちで、あとから
      // 「あの契約書を審査したのはどれか」で辿ることの方が多い
      whereCondition.OR = [
        { name: { contains: needle } },
        { documents: { some: { filename: { contains: needle } } } },
      ];
    }
    if (checkListSetId) {
      whereCondition.checkListSetId = checkListSetId;
    }
    // 見える範囲。自分のものと、社内に公開されたもの。管理者は絞らない。
    // 検索の OR と混ざらないよう AND に入れる
    const visible = visibilityFilter(params.visibleTo);
    if (visible) {
      whereCondition.AND = [visible];
    }

    // ページネーション用のクエリを並列実行
    const [jobs, total] = await Promise.all([
      client.reviewJob.findMany({
        where: whereCondition,
        // チェックリストは関連先の名前で、ドキュメントは別テーブルなので件数で。
        // それ以外は列の名前をそのまま使う
        orderBy:
          sortBy === "checkListSet"
            ? { checkListSet: { name: sortOrder } }
            : sortBy === "documents"
              ? { documents: { _count: sortOrder } }
              : { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          documents: {
            select: {
              id: true,
              filename: true,
              s3Path: true,
              fileType: true,
            },
            orderBy: {
              id: "asc",
            },
          },
          checkListSet: {
            select: {
              id: true,
              name: true,
            },
          },
          // サマリー情報計算用にレビュー結果も同時取得
          reviewResults: {
            select: {
              checkId: true,
              status: true,
              result: true,
              checkList: { select: { parentId: true } },
            },
          },
        },
      }),
      client.reviewJob.count({
        where: whereCondition,
      }),
    ]);

    // 項目を選んで作ったジョブを見分けるため、チェックリストの項目を読む
    const checkItems = await client.checkList.findMany({
      where: {
        checkListSetId: {
          in: Array.from(new Set(jobs.map((job) => job.checkListSetId))),
        },
      },
      select: { id: true, parentId: true, checkListSetId: true },
    });

    // 各ジョブのモデルを構築
    const mappedJobs = jobs.map((job) => {
      // サマリー情報を計算
      const reviewResults = job.reviewResults || [];
      const stats = {
        total: reviewResults.length,
        passed: reviewResults.filter((r) => r.result === "pass").length,
        failed: reviewResults.filter((r) => r.result === "fail").length,
        processing: reviewResults.filter((r) => r.status !== "completed")
          .length,
      };

      return {
        id: job.id,
        name: job.name,
        status: job.status as REVIEW_JOB_STATUS,
        checkListSetId: job.checkListSetId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt || undefined,
        userId: job.userId || undefined,
        sharedWithOrg: job.sharedWithOrg,
        // 実行中や失敗したジョブには費用が入っていない
        totalCost: job.totalCost ? Number(job.totalCost) : undefined,
        documents: job.documents.map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          s3Path: doc.s3Path,
          fileType: doc.fileType as REVIEW_FILE_TYPE,
        })),
        checkListSet: {
          id: job.checkListSet.id,
          name: job.checkListSet.name,
        },
        stats,
        checkItemCounts: countCheckItems(
          checkItems.filter(
            (item) => item.checkListSetId === job.checkListSetId
          ),
          reviewResults.map((r) => r.checkId)
        ),
        progress: countReviewProgress(
          reviewResults.map((r) => ({
            checkId: r.checkId,
            status: r.status,
            parentId: r.checkList.parentId,
          }))
        ),
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      items: mappedJobs,
      total,
      page,
      limit,
      totalPages,
    };
  };

  const updateJobSharing = async (params: {
    reviewJobId: string;
    sharedWithOrg: boolean;
  }): Promise<void> => {
    await client.reviewJob.update({
      where: { id: params.reviewJobId },
      data: { sharedWithOrg: params.sharedWithOrg },
    });
  };

  const summarizeReviewCost = async (
    params: { ownerUserId?: string; tzOffsetMinutes?: number } & ReviewJobPeriod
  ): Promise<ReviewCostSummary> => {
    const where: {
      userId?: string;
      createdAt?: { gte?: Date; lte?: Date };
    } = {};
    if (params.ownerUserId) {
      where.userId = params.ownerUserId;
    }
    if (params.createdFrom || params.createdTo) {
      where.createdAt = {
        ...(params.createdFrom ? { gte: params.createdFrom } : {}),
        ...(params.createdTo ? { lte: params.createdTo } : {}),
      };
    }

    // 月ごとの集計は SQL では書きにくい（利用者の時間帯で月を切るため）ので、
    // 費用に要る列だけを読んで手元でまとめる。読むのは1件あたり数十バイトで、
    // 審査ジョブがこの方法で重くなるのはずっと先
    const jobs = await client.reviewJob.findMany({
      where,
      select: {
        id: true,
        name: true,
        createdAt: true,
        totalCost: true,
        totalInputTokens: true,
        totalOutputTokens: true,
        checkListSetId: true,
        checkListSet: { select: { name: true } },
      },
    });

    return summarizeCost(
      jobs.map((job) => ({
        id: job.id,
        name: job.name,
        createdAt: job.createdAt,
        totalCost: job.totalCost === null ? null : Number(job.totalCost),
        totalInputTokens: job.totalInputTokens,
        totalOutputTokens: job.totalOutputTokens,
        checkListSetId: job.checkListSetId,
        checkListSetName: job.checkListSet.name,
      })),
      params.tzOffsetMinutes ?? 0
    );
  };

  const findReviewJobById = async (params: {
    reviewJobId: string;
  }): Promise<ReviewJobDetail> => {
    const { reviewJobId } = params;

    // Cannot use both 'include' and 'select' in the same query
    const job = await client.reviewJob.findUnique({
      where: { id: reviewJobId },
      include: {
        sourceReviewJob: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            documents: { orderBy: { id: "asc" } },
          },
        },
        rerunJobs: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            revisionNote: true,
          },
          orderBy: { createdAt: "desc" },
        },
        documents: {
          orderBy: {
            id: "asc",
          },
        },
        checkListSet: {
          include: {
            documents: true,
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundError(`Review job not found`, reviewJobId);
    }

    // 項目を選んで作ったジョブを見分けるためと、進み具合を数えるため、
    // 結果の項目と状態、チェックリストの項目を読む
    const [jobResults, checkItems] = await Promise.all([
      client.reviewResult.findMany({
        where: { reviewJobId },
        select: {
          checkId: true,
          status: true,
          checkList: { select: { parentId: true } },
        },
      }),
      client.checkList.findMany({
        where: { checkListSetId: job.checkListSetId },
        select: { id: true, parentId: true },
      }),
    ]);

    console.log(
      `[DEBUG REPO] Full job data from database: ${JSON.stringify(job)}`
    );

    return {
      id: job.id,
      name: job.name,
      status: job.status as REVIEW_JOB_STATUS,
      errorDetail: job.errorDetail || undefined,
      hasError: job.status === REVIEW_JOB_STATUS.FAILED && !!job.errorDetail,
      checkList: {
        id: job.checkListSet.id,
        name: job.checkListSet.name,
        description: job.checkListSet.description || "",
        documents: job.checkListSet.documents.map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          s3Key: doc.s3Path,
          fileType: doc.fileType,
          uploadDate: doc.uploadDate,
          status: doc.status as CHECK_LIST_STATUS,
        })),
        createdAt: job.checkListSet.createdAt,
      },
      documents: job.documents.map(toReviewJobDocument),
      userId: job.userId || undefined,
      sharedWithOrg: job.sharedWithOrg,
      executionArn: job.executionArn ?? undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt || undefined,
      totalInputTokens: job.totalInputTokens || undefined,
      totalOutputTokens: job.totalOutputTokens || undefined,
      totalCost: job.totalCost ? Number(job.totalCost) : undefined,
      sourceReviewJob: job.sourceReviewJob
        ? {
            ...job.sourceReviewJob,
            status: job.sourceReviewJob.status as REVIEW_JOB_STATUS,
            documents: job.sourceReviewJob.documents.map(toReviewJobDocument),
          }
        : undefined,
      rerunJobs: job.rerunJobs.map((rerun) => ({
        ...rerun,
        status: rerun.status as REVIEW_JOB_STATUS,
        revisionNote: rerun.revisionNote ?? undefined,
      })),
      revisionNote: job.revisionNote ?? undefined,
      checkItemCounts: countCheckItems(
        checkItems,
        jobResults.map((r) => r.checkId)
      ),
      progress: countReviewProgress(
        jobResults.map((r) => ({
          checkId: r.checkId,
          status: r.status,
          parentId: r.checkList.parentId,
        }))
      ),
    };
  };

  const createReviewJob = async (params: ReviewJobEntity): Promise<void> => {
    const now = new Date();

    await client.$transaction(async (tx) => {
      await tx.reviewJob.create({
        data: {
          id: params.id,
          name: params.name,
          status: params.status,
          checkListSetId: params.checkListSetId,
          createdAt: now,
          updatedAt: now,
          userId: params.userId,
          sourceReviewJobId: params.sourceReviewJobId,
          revisionNote: params.revisionNote,
        },
        include: {
          documents: true,
          checkListSet: true,
        },
      });

      // 審査ドキュメントを作成
      for (const doc of params.documents) {
        await tx.reviewDocument.create({
          data: {
            id: doc.id,
            filename: doc.filename,
            s3Path: doc.s3Key,
            fileType: doc.fileType,
            uploadDate: doc.uploadDate ?? now,
            status: "processing",
            reviewJobId: params.id,
            carriedFromDocumentId: doc.carriedFromDocumentId,
            replacesDocumentId: doc.replacesDocumentId,
          },
        });
      }

      // 審査結果を作成
      for (const result of params.results) {
        await tx.reviewResult.create({
          data: {
            id: result.id,
            reviewJobId: params.id,
            checkId: result.checkId,
            status: result.status,
            userOverride: result.userOverride,
            createdAt: now,
            updatedAt: now,
            // 再審査で引き継ぐ結果の中身。新しい結果では未設定
            result: result.result,
            confidenceScore: result.confidenceScore,
            explanation: result.explanation,
            shortExplanation: result.shortExplanation,
            extractedText: result.extractedText
              ? (JSON.stringify(result.extractedText) as any)
              : undefined,
            userComment: result.userComment,
            // 再審査で引き継ぐ結果では、AI の判定と覆した理由も引き継ぐ。
            // 引き継ぎは同じ判定の写しなので、履歴としても同じ形にしておく
            aiResult: result.aiResult,
            overrideReason: result.overrideReason,
            sourceReferences: result.sourceReferences
              ? JSON.stringify(result.sourceReferences)
              : undefined,
            externalSources: result.externalSources
              ? JSON.stringify(result.externalSources)
              : undefined,
            previousResultId: result.previousResultId,
            carriedOver: result.carriedOver ?? false,
            judgedInReviewJobId: result.judgedInReviewJobId,
          },
        });
      }
    });
  };

  const deleteReviewJobById = async (params: {
    reviewJobId: string;
  }): Promise<void> => {
    const { reviewJobId } = params;

    await client.$transaction(async (tx) => {
      // 関連する審査結果を削除
      await tx.reviewResult.deleteMany({ where: { reviewJobId } });

      // 関連する審査ドキュメントを削除
      await tx.reviewDocument.deleteMany({ where: { reviewJobId } });

      // 審査ジョブを削除
      await tx.reviewJob.delete({ where: { id: reviewJobId } });
    });
  };

  const updateJobStatus = async (params: {
    reviewJobId: string;
    status: REVIEW_JOB_STATUS;
    errorDetail?: string;
  }): Promise<void> => {
    const { reviewJobId, status, errorDetail } = params;
    // 中止は人が決めたことなので、あとから届いた自動更新より強い。
    // 条件付きで書き換えることで、読んでから書くまでの隙間で
    // 中止が入っても取りこぼさない
    const updated = await client.reviewJob.updateMany({
      where: {
        id: reviewJobId,
        ...(status === REVIEW_JOB_STATUS.CANCELLED
          ? {}
          : { status: { not: REVIEW_JOB_STATUS.CANCELLED } }),
      },
      data: {
        status,
        errorDetail,
        updatedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      console.info(
        `Left the review job as it is; it was cancelled: ${reviewJobId}`
      );
    }
  };

  const updateJobExecution = async (params: {
    reviewJobId: string;
    executionArn: string;
  }): Promise<void> => {
    await client.reviewJob.update({
      where: { id: params.reviewJobId },
      data: { executionArn: params.executionArn },
    });
  };

  const updateJobCostInfo = async (params: {
    reviewJobId: string;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }): Promise<void> => {
    const { reviewJobId, totalCost, totalInputTokens, totalOutputTokens } =
      params;
    await client.reviewJob.update({
      where: { id: reviewJobId },
      data: {
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        updatedAt: new Date(),
      },
    });
  };

  return {
    findAllReviewJobs,
    summarizeReviewCost,
    updateJobExecution,
    updateJobSharing,
    findReviewJobById,
    createReviewJob,
    deleteReviewJobById,
    updateJobStatus,
    updateJobCostInfo,
  };
};

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
        checkList: true,
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
        checkList: true,
        previousResult: { select: ReviewResultDomain.previousResultSelect },
      },
      orderBy: {
        checkId: "asc",
      },
    });

    console.log(`[Repository] Found ${results.length} results`);

    // 結果のcheckIdとparentIdをログ出力
    console.log(
      `[Repository] Result checkIds and parentIds:`,
      results.map((r) => ({
        checkId: r.checkId,
        parentId: r.checkList.parentId,
      }))
    );

    if (results.length === 0) {
      return [];
    }

    // 子要素の有無を一括確認
    const checkIds = results.map((result) => result.checkId);

    console.log(`[Repository] Checking for children of checkIds:`, checkIds);

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
