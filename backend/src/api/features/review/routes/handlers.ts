import { FastifyReply, FastifyRequest } from "fastify";
import {
  computeGlobalConcurrency,
  createReviewJob,
  getAllReviewJobs,
  getReviewCostSummary,
  setReviewJobSharing,
  cancelReviewJob,
  getReviewJobById,
  getReviewDocumentPresignedUrl,
  getReviewDocumentsPresignedUrl,
  getReviewImagesPresignedUrl,
  removeReviewJob,
} from "../usecase/review-job";
import { deleteS3Object } from "../../../core/s3";
import {
  isOverrideReason,
  REVIEW_FILE_TYPE,
  REVIEW_RESULT,
} from "../domain/model/review";
import {
  overrideReviewResult,
  getReviewResults,
} from "../usecase/review-result";
import { getDocumentDownloadUrl } from "../usecase/document";
import { MAX_REVIEW_DOCUMENTS } from "../../../constants";

export const getAllReviewJobsHandler = async (
  request: FastifyRequest<{
    Querystring: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      status?: string;
      search?: string;
      checkListSetId?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> => {
  const {
    page = 1,
    limit = 10,
    sortBy = "id",
    sortOrder = "desc",
    status,
    search,
    checkListSetId,
  } = request.query;

  // Convert string query parameters to numbers
  const pageNum = typeof page === "string" ? parseInt(page, 10) : page;
  const limitNum = typeof limit === "string" ? parseInt(limit, 10) : limit;

  // Validate sortBy parameter - only allow valid fields
  // 一覧の主役の列なので名前でも並べられるようにする。
  // checkListSet は関連先の名前で並べる
  const validSortFields = [
    "id",
    "name",
    "createdAt",
    "status",
    "checkListSet",
    "totalCost",
  ];
  const validSortBy = validSortFields.includes(sortBy) ? sortBy : "id";

  const result = await getAllReviewJobs({
    page: pageNum,
    limit: limitNum,
    sortBy: validSortBy,
    sortOrder,
    status,
    search,
    checkListSetId,
    user: request.user,
  });

  reply.code(200).send({
    success: true,
    data: result,
  });
};

export const getReviewCostSummaryHandler = async (
  request: FastifyRequest<{
    Querystring: {
      createdFrom?: string;
      createdTo?: string;
      /** 月を切る時間帯。画面の getTimezoneOffset をそのまま渡す */
      tzOffsetMinutes?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> => {
  const { createdFrom, createdTo, tzOffsetMinutes } = request.query;

  const parseDate = (value?: string): Date | undefined => {
    if (!value) {
      return undefined;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  // 読めない値なら UTC で切る。ここで落とすほどのことではない
  const offset = Number(tzOffsetMinutes);

  const result = await getReviewCostSummary({
    createdFrom: parseDate(createdFrom),
    createdTo: parseDate(createdTo),
    tzOffsetMinutes: Number.isFinite(offset) ? offset : 0,
    user: request.user,
  });

  reply.code(200).send({
    success: true,
    data: result,
  });
};

interface GetPresignedUrlRequest {
  filename: string;
  contentType: string;
}

export const getReviewPresignedUrlHandler = async (
  request: FastifyRequest<{ Body: GetPresignedUrlRequest }>,
  reply: FastifyReply
): Promise<void> => {
  const { filename, contentType } = request.body;

  const result = await getReviewDocumentPresignedUrl({
    filename,
    contentType,
  });

  reply.code(200).send({
    success: true,
    data: result,
  });
};

export const getReviewDocumentsPresignedUrlHandler = async (
  request: FastifyRequest<{
    Body: { filenames: string[]; contentTypes: string[] };
  }>,
  reply: FastifyReply
): Promise<void> => {
  const { filenames, contentTypes } = request.body;

  if (filenames.length > MAX_REVIEW_DOCUMENTS) {
    reply.code(400).send({
      success: false,
      error: `Maximum ${MAX_REVIEW_DOCUMENTS} documents allowed`,
    });
    return;
  }

  const result = await getReviewDocumentsPresignedUrl({
    filenames,
    contentTypes,
  });

  reply.code(200).send({
    success: true,
    data: result,
  });
};

export const getReviewImagesPresignedUrlHandler = async (
  request: FastifyRequest<{
    Body: { filenames: string[]; contentTypes: string[] };
  }>,
  reply: FastifyReply
): Promise<void> => {
  const { filenames, contentTypes } = request.body;

  if (filenames.length > 20) {
    reply.code(400).send({
      success: false,
      error: "Maximum 20 image files allowed",
    });
    return;
  }

  const result = await getReviewImagesPresignedUrl({
    filenames,
    contentTypes,
  });

  reply.code(200).send({
    success: true,
    data: result,
  });
};

export const deleteReviewDocumentHandler = async (
  request: FastifyRequest<{ Params: { key: string } }>,
  reply: FastifyReply
): Promise<void> => {
  const { key } = request.params;
  const bucketName = process.env.DOCUMENT_BUCKET;
  if (!bucketName) {
    throw new Error("Bucket name is not defined");
  }
  await deleteS3Object(bucketName, key);

  reply.code(200).send({
    success: true,
    data: {
      deleted: true,
    },
  });
};

export interface CreateReviewJobRequest {
  name: string;
  checkListSetId: string;
  documents: Array<{
    id: string;
    filename: string;
    s3Key: string;
    fileType: REVIEW_FILE_TYPE;
    /** 再審査で、この文書が差し替える元のジョブの文書 */
    replacesDocumentId?: string;
  }>;
  userId?: string;
  /** 審査するチェック項目。省略するとすべての項目を審査する */
  checkIds?: string[];
  /**
   * 再審査の元になる審査ジョブ。指定すると、審査し直す項目（checkIds、省略時は
   * 元のジョブで不合格だった項目）以外は元の結果を引き継ぐ
   */
  sourceReviewJobId?: string;
  /** 再審査で何を直したかのメモ（任意） */
  revisionNote?: string;
  /** 再審査で、元のジョブから引き継ぐ文書。アップロードし直さずに審査に使う */
  keptDocumentIds?: string[];
}

export const createReviewJobHandler = async (
  request: FastifyRequest<{ Body: CreateReviewJobRequest }>,
  reply: FastifyReply
): Promise<void> => {
  const { isLimit } = await computeGlobalConcurrency();
  if (isLimit) {
    reply.code(429).send({
      success: false,
      error: "System is busy",
      code: "REVIEW_GLOBAL_CONCURRENCY_EXCEEDED",
      data: {},
    });
    return;
  }

  await createReviewJob({
    requestBody: {
      ...request.body,
      userId: request.user?.userId,
    },
    user: request.user,
  });
  reply.code(201).send({
    success: true,
    data: {},
  });
};

export const deleteReviewJobHandler = async (
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply
): Promise<void> => {
  const { jobId } = request.params;
  await removeReviewJob({
    reviewJobId: jobId,
    user: request.user,
  });
  reply.code(200).send({
    success: true,
    data: {},
  });
};

export const getReviewResultItemsHandler = async (
  request: FastifyRequest<{
    Params: { jobId: string };
    Querystring: {
      parentId?: string;
      filter?: string;
      includeAllChildren?: string;
      importance?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> => {
  const results = await getReviewResults({
    reviewJobId: request.params.jobId,
    parentId: request.query.parentId,
    filter: request.query.filter
      ? (request.query.filter as REVIEW_RESULT)
      : undefined,
    includeAllChildren: request.query.includeAllChildren === "true",
    importance: request.query.importance,
    user: request.user,
  });
  reply.code(200).send({
    success: true,
    data: results,
  });
};

export interface OverrideReviewResultRequest {
  result: REVIEW_RESULT;
  userComment: string;
  /** 覆した理由。古い画面からは送られてこない */
  overrideReason?: string;
}

export const overrideReviewResultHandler = async (
  request: FastifyRequest<{
    Params: { jobId: string; resultId: string };
    Body: OverrideReviewResultRequest;
  }>,
  reply: FastifyReply
): Promise<void> => {
  const { jobId, resultId } = request.params;
  const { result, userComment, overrideReason } = request.body;

  await overrideReviewResult({
    reviewJobId: jobId,
    resultId,
    result,
    userComment,
    // 知らない値は捨てる。集計の選択肢に化けたものが混じると読めなくなる
    overrideReason: isOverrideReason(overrideReason)
      ? overrideReason
      : undefined,
    user: request.user,
  });

  reply.code(200).send({
    success: true,
    data: {},
  });
};
export const cancelReviewJobHandler = async (
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply
): Promise<void> => {
  await cancelReviewJob({
    reviewJobId: request.params.jobId,
    user: request.user,
  });

  reply.code(200).send({ success: true, data: {} });
};

export const setReviewJobSharingHandler = async (
  request: FastifyRequest<{
    Params: { jobId: string };
    Body: { sharedWithOrg: boolean };
  }>,
  reply: FastifyReply
): Promise<void> => {
  await setReviewJobSharing({
    reviewJobId: request.params.jobId,
    sharedWithOrg: request.body.sharedWithOrg === true,
    user: request.user,
  });

  reply.code(200).send({ success: true, data: {} });
};

export const getReviewJobByIdHandler = async (
  request: FastifyRequest<{ Params: { jobId: string } }>,
  reply: FastifyReply
): Promise<void> => {
  const { jobId } = request.params;
  const job = await getReviewJobById({
    reviewJobId: jobId,
    user: request.user,
  });

  reply.code(200).send({
    success: true,
    data: job,
  });
};

interface GetDownloadPresignedUrlRequest {
  key: string;
  bucket?: string;
  expiresIn?: number;
}

/**
 * ドキュメント�Eダウンロード用Presigned URLを取得するハンドラー
 */
export const getDownloadPresignedUrlHandler = async (
  request: FastifyRequest<{ Querystring: GetDownloadPresignedUrlRequest }>,
  reply: FastifyReply
): Promise<void> => {
  const { key, bucket, expiresIn = 3600 } = request.query;

  const url = await getDocumentDownloadUrl({
    key,
    bucket,
    expiresIn:
      typeof expiresIn === "string" ? parseInt(expiresIn, 10) : expiresIn,
  });

  reply.code(200).send({
    success: true,
    data: {
      url,
    },
  });
};
