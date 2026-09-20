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
  /** 部署ごと。高い順。部署の付いていない審査は入らない */
  byDepartment: Array<{
    departmentId: string;
    totalCost: number;
    jobCount: number;
  }>;
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
    /** この部署の審査だけ。部署ごとの履歴を見るのに使う */
    departmentId?: string;
  }): Promise<PaginatedResponse<ReviewJobSummary>>;
  summarizeReviewCost(
    params: {
      ownerUserId?: string;
      /** 月を切る時間帯。getTimezoneOffset と同じ向き */
      tzOffsetMinutes?: number;
      /** 部署で絞る */
      departmentId?: string;
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
      departmentId?: string;
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
      departmentId,
    } = params;

    // WHERE条件を構築
    const whereCondition: {
      status?: string;
      checkListSetId?: string;
      departmentId?: string;
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
    if (departmentId) {
      whereCondition.departmentId = departmentId;
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
        departmentId: job.departmentId ?? undefined,
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

  const summarizeReviewCost = async (
    params: {
      ownerUserId?: string;
      tzOffsetMinutes?: number;
      /** 部署で絞る。部署ごとの費用を見るのに使う */
      departmentId?: string;
    } & ReviewJobPeriod
  ): Promise<ReviewCostSummary> => {
    const where: {
      userId?: string;
      departmentId?: string;
      createdAt?: { gte?: Date; lte?: Date };
    } = {};
    if (params.ownerUserId) {
      where.userId = params.ownerUserId;
    }
    if (params.departmentId) {
      where.departmentId = params.departmentId;
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
        departmentId: true,
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
        departmentId: job.departmentId,
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
      departmentId: job.departmentId ?? undefined,
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
          departmentId: params.departmentId,
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
            overriddenBy: result.overriddenBy,
            overriddenAt: result.overriddenAt,
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
    findReviewJobById,
    createReviewJob,
    deleteReviewJobById,
    updateJobStatus,
    updateJobCostInfo,
  };
};
