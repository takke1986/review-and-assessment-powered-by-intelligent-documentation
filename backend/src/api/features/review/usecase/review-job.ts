import {
  REVIEW_JOB_STATUS,
  ReviewJobSummary,
  ReviewJobDetail,
  ReviewJobDocument,
  ReviewResultDetail,
} from "../domain/model/review";
import { assertCanUseCheckListSetOrThrow } from "../../../core/access/checklist-access";
import { assertUploadKeyOrThrow } from "../../../core/access/upload-key";
import { PaginatedResponse } from "../../../common/types";
import { ListParams } from "../../../common/pagination";
import {
  ReviewCostSummary,
  ReviewJobRepository,
  makePrismaReviewJobRepository,
} from "../domain/repository";
import {
  ReviewResultRepository,
  makePrismaReviewResultRepository,
} from "../domain/review-result-repository";
import { ulid } from "ulid";
import { getPresignedUrl, getS3ObjectSize } from "../../../core/s3";
import {
  getReviewDocumentKey,
  getReviewImageKey,
} from "../../../../checklist-workflow/common/storage-paths";
import { getQueueDepth, sendMessage } from "../../../core/sqs";
import { MAX_REVIEW_DOCUMENTS } from "../../../constants";
import { CreateReviewJobRequest } from "../routes/handlers";
import { createInitialReviewJobModel } from "../domain/service/review-job-factory";
import {
  CheckRepository,
  makePrismaCheckRepository,
} from "../../checklist/domain/repository";
import {
  ApplicationError,
  FileSizeExceededError,
  ValidationError,
} from "../../../core/errors/application-errors";
import { validateFileSize } from "../../../core/file-validation";
import { maxFileSizeFor } from "../../../constants/index";
import type { RequestUser } from "../../../core/middleware/authorization";
import { assertHasOwnerAccessOrThrow } from "../../../core/middleware/authorization";
import {
  assertCanViewOrThrow,
  canEdit,
  toViewer,
} from "../../../core/access/visibility";
import { canCancel } from "../domain/service/review-job-cancel";
import { canReviewAgain } from "../domain/service/review-again";
import { canResume } from "../domain/service/review-resume";
import { resolveDepartment } from "../../../core/access/departments";
import { stopStateMachineExecution } from "../../../core/sfn";

export const computeGlobalConcurrency = async (): Promise<{
  isLimit: boolean;
}> => {
  console.info("computeGlobalConcurrency called");

  const queueUrl = process.env.REVIEW_QUEUE_URL;
  const maxDepth = Number(process.env.REVIEW_QUEUE_MAX_DEPTH ?? 0);

  if (!queueUrl || maxDepth <= 0) {
    console.info("Global concurrency check skipped", {
      queueUrl,
      maxDepth,
    });
    return { isLimit: false };
  }

  try {
    const depth = await getQueueDepth(queueUrl);
    console.info("SQS queue depth fetched", { queueUrl, depth });
    if (depth.total >= maxDepth) {
      console.warn("Global concurrency limit reached", { depth, maxDepth });
      return { isLimit: true };
    }
  } catch (e) {
    console.error("Failed to check global concurrency — failing closed:", e);
    return { isLimit: true };
  }

  console.info("Global concurrency check passed");
  return { isLimit: false };
};

export const getAllReviewJobs = async (
  params: ListParams & {
    status?: string;
    /** このチェックリストを使ったジョブだけ */
    checkListSetId?: string;
    /** この部署の審査だけ。部署ごとの履歴を見るのに使う */
    departmentId?: string;
    // オプショナルでリクエストユーザーを受け取り、一般ユーザの場合は ownerUserId を使って絞る
    user: RequestUser;
    deps?: {
      repo?: ReviewJobRepository;
    };
  }
): Promise<PaginatedResponse<ReviewJobSummary>> => {
  const repo = params.deps?.repo || (await makePrismaReviewJobRepository());

  // 自分のものと、社内に公開されたものが見える（管理者は全件）
  const result = await repo.findAllReviewJobs({
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    status: params.status,
    search: params.search,
    checkListSetId: params.checkListSetId,
    departmentId: params.departmentId,
    visibleTo: toViewer(params.user),
  });
  return result;
};

/**
 * 費用の内訳を返す。
 *
 * 一般利用者には自分のジョブだけ。管理者は全体。一覧と同じ見え方に合わせる
 */
export const getReviewCostSummary = async (params: {
  createdFrom?: Date;
  createdTo?: Date;
  /** 月を切る時間帯。getTimezoneOffset と同じ向き */
  tzOffsetMinutes?: number;
  user: RequestUser;
  deps?: {
    repo?: ReviewJobRepository;
  };
}): Promise<ReviewCostSummary> => {
  const repo = params.deps?.repo || (await makePrismaReviewJobRepository());
  const ownerUserId =
    params.user && !params.user.isAdmin ? params.user.userId : undefined;

  return repo.summarizeReviewCost({
    createdFrom: params.createdFrom,
    createdTo: params.createdTo,
    tzOffsetMinutes: params.tzOffsetMinutes,
    ownerUserId,
  });
};

/**
 * 審査を途中で止める。
 *
 * 文書を間違えて始めても、これまでは終わるまで待って費用も払うしかなかった。
 *
 * 走っているものは実行ごと止める。まだ待ち行列にいるものは止める相手が
 * いないので、状態だけ中止にしておき、始まるときに気づかせる
 */
export const cancelReviewJob = async (params: {
  reviewJobId: string;
  user?: RequestUser;
  deps?: { repo?: ReviewJobRepository };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaReviewJobRepository());
  const job = await repo.findReviewJobById({ reviewJobId: params.reviewJobId });
  assertHasOwnerAccessOrThrow(params.user, job.userId, {
    api: "cancelReviewJob",
    resourceId: job.id,
    logger: console,
  });

  if (!canCancel(job.status)) {
    throw new ValidationError(
      `This review job is not running, so it cannot be cancelled: ${job.status}`
    );
  }

  // 先に状態を書く。止めるのに失敗しても、始まるときに気づいて止まる
  await repo.updateJobStatus({
    reviewJobId: params.reviewJobId,
    status: REVIEW_JOB_STATUS.CANCELLED,
  });

  if (job.executionArn) {
    await stopStateMachineExecution(job.executionArn, "Cancelled by the user");
  }
};

/**
 * 途中で終わった審査を、そのジョブのまま続きから流す。
 *
 * 判定の済んだ項目はそのまま残り、審査の準備処理が未判定の項目だけを
 * 拾う。だからここでは、状態を待ちに戻して、もう一度待ち行列に入れる
 * だけでよい。
 *
 * 状態を先に書くのは、準備処理が「中止」を見つけたら何もせずに終わる
 * ようにしてあるため。待ちに戻さずに送ると、送った先で止められる
 */
export const resumeReviewJob = async (params: {
  reviewJobId: string;
  user?: RequestUser;
  deps?: { repo?: ReviewJobRepository };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaReviewJobRepository());
  const job = await repo.findReviewJobById({ reviewJobId: params.reviewJobId });
  assertHasOwnerAccessOrThrow(params.user, job.userId, {
    api: "resumeReviewJob",
    resourceId: job.id,
    logger: console,
  });

  if (!canResume(job.status)) {
    throw new ValidationError(
      `This review job did not end early, so there is nothing to carry on with: ${job.status}`
    );
  }

  const queueUrl = process.env.REVIEW_QUEUE_URL;
  if (!queueUrl) {
    throw new ApplicationError("REVIEW_QUEUE_URL is not defined");
  }

  // 読んでから書くまでの隙間に状態が変わっていたら、ここで止まる。
  // 二重に押されたときに、同じジョブを2回待ち行列へ入れないため
  const reopened = await repo.reopenJob({ reviewJobId: params.reviewJobId });
  if (!reopened) {
    throw new ValidationError(
      "This review job is no longer waiting to be carried on with"
    );
  }

  try {
    await sendMessage(
      queueUrl,
      { reviewJobId: job.id, userId: job.userId },
      job.id,
      // 1回目と同じ本文なので、識別子を変えないと重複と見なされて捨てられる
      ulid()
    );
  } catch (error) {
    // キューに入らなかったジョブは動かない。待ちのまま残さず失敗にする
    await repo
      .updateJobStatus({
        reviewJobId: job.id,
        status: REVIEW_JOB_STATUS.FAILED,
        errorDetail: "Failed to queue the review job",
      })
      .catch((statusError) =>
        console.error(
          `Failed to mark review job ${job.id} as failed:`,
          statusError
        )
      );
    throw error;
  }
};

export const getReviewDocumentPresignedUrl = async (params: {
  filename: string;
  contentType: string;
}): Promise<{ url: string; key: string; documentId: string }> => {
  const { filename, contentType } = params;
  const bucketName = process.env.DOCUMENT_BUCKET;
  if (!bucketName) {
    throw new Error("S3_BUCKET_NAME is not defined");
  }
  const documentId = ulid();
  const key = getReviewDocumentKey(documentId, filename);
  const url = await getPresignedUrl(bucketName, key, contentType);

  return { url, key, documentId };
};

export const getReviewDocumentsPresignedUrl = async (params: {
  filenames: string[];
  contentTypes: string[];
}): Promise<{
  files: Array<{
    url: string;
    key: string;
    filename: string;
    documentId: string;
  }>;
}> => {
  const { filenames, contentTypes } = params;
  const bucketName = process.env.DOCUMENT_BUCKET;
  if (!bucketName) {
    throw new Error("S3_BUCKET_NAME is not defined");
  }

  // 審査ジョブ作成時の上限（createReviewJob）と同じ値に揃える
  if (filenames.length > MAX_REVIEW_DOCUMENTS) {
    throw new ApplicationError(
      `Maximum ${MAX_REVIEW_DOCUMENTS} documents allowed`
    );
  }

  const results = await Promise.all(
    filenames.map(async (filename, index) => {
      const contentType = contentTypes[index];
      const documentId = ulid();
      const key = getReviewDocumentKey(documentId, filename);
      const url = await getPresignedUrl(bucketName, key, contentType);

      return { url, key, filename, documentId };
    })
  );

  return { files: results };
};

export const getReviewImagesPresignedUrl = async (params: {
  filenames: string[];
  contentTypes: string[];
}): Promise<{
  files: Array<{
    url: string;
    key: string;
    filename: string;
    documentId: string;
  }>;
}> => {
  const { filenames, contentTypes } = params;
  const bucketName = process.env.DOCUMENT_BUCKET;
  if (!bucketName) {
    throw new Error("S3_BUCKET_NAME is not defined");
  }

  if (filenames.length > MAX_REVIEW_DOCUMENTS) {
    throw new ApplicationError(
      `Maximum ${MAX_REVIEW_DOCUMENTS} image files allowed`
    );
  }

  const results = await Promise.all(
    filenames.map(async (filename, index) => {
      const contentType = contentTypes[index];
      const documentId = ulid();
      const key = getReviewImageKey(documentId, filename);
      const url = await getPresignedUrl(bucketName, key, contentType);
      return { url, key, filename, documentId };
    })
  );

  return {
    files: results,
  };
};

/**
 * 審査する文書の数と、アップロードした文書のファイルサイズを確認する。
 * 再審査では、元のジョブから引き継ぐ文書も審査する文書に数える。
 */
const validateJobDocuments = async (
  requestBody: CreateReviewJobRequest
): Promise<void> => {
  const uploadedDocuments = requestBody.documents ?? [];
  const documentCount =
    uploadedDocuments.length + (requestBody.keptDocumentIds?.length ?? 0);
  if (documentCount === 0) {
    throw new ApplicationError("At least one document is required");
  }

  if (documentCount > MAX_REVIEW_DOCUMENTS) {
    throw new ApplicationError(
      `Maximum ${MAX_REVIEW_DOCUMENTS} documents allowed`
    );
  }

  // 他人がアップロードした書類のキーを書かれても使わない
  for (const doc of uploadedDocuments) {
    assertUploadKeyOrThrow(doc, ["review/original/", "review/images/"]);
  }

  // Validate file sizes from S3
  const bucketName = process.env.DOCUMENT_BUCKET;
  if (!bucketName) {
    throw new ApplicationError("DOCUMENT_BUCKET is not defined");
  }

  for (const doc of uploadedDocuments) {
    try {
      const fileSize = await getS3ObjectSize(bucketName, doc.s3Key);
      const limit = maxFileSizeFor(doc.filename);
      if (!validateFileSize(fileSize, limit)) {
        throw new FileSizeExceededError(doc.filename, fileSize, limit);
      }
    } catch (error) {
      if (error instanceof FileSizeExceededError) {
        throw error;
      }
      // If file doesn't exist or other S3 error, let it proceed (will fail later in processing)
      console.warn(`Could not validate file size for ${doc.s3Key}:`, error);
    }
  }
};

export const createReviewJob = async (params: {
  requestBody: CreateReviewJobRequest & { userId: string; userName?: string };
  /** 始める人。使えるチェックリストかどうかを確かめる */
  user: RequestUser;
  deps?: {
    checkRepo?: CheckRepository;
    reviewJobRepo?: ReviewJobRepository;
    reviewResultRepo?: ReviewResultRepository;
  };
}): Promise<void> => {
  const checkRepo =
    params.deps?.checkRepo || (await makePrismaCheckRepository());
  const reviewJobRepo =
    params.deps?.reviewJobRepo || (await makePrismaReviewJobRepository());

  // 使えるチェックリストでしか審査を始められない。ID さえ分かれば
  // 他部署のチェックリストで審査できる状態だった
  assertCanUseCheckListSetOrThrow(
    params.user,
    await checkRepo.findCheckListSetAccess(params.requestBody.checkListSetId),
    { api: "createReviewJob", logger: console }
  );

  await validateJobDocuments(params.requestBody);

  const source = params.requestBody.sourceReviewJobId
    ? await loadRerunSource({
        sourceReviewJobId: params.requestBody.sourceReviewJobId,
        checkListSetId: params.requestBody.checkListSetId,
        user: params.user,
        deps: {
          reviewJobRepo,
          reviewResultRepo: params.deps?.reviewResultRepo,
        },
      })
    : undefined;

  const reviewJob = await createInitialReviewJobModel({
    req: params.requestBody,
    deps: {
      checkRepo,
    },
    source,
  });

  // レビュー処理キューへメッセージ送信
  const queueUrl = process.env.REVIEW_QUEUE_URL;
  if (!queueUrl) {
    const error = new ApplicationError("REVIEW_QUEUE_URL is not defined");
    throw error;
  }

  // ジョブを保存してからキューに送る。先に送ると、審査の準備処理が
  // まだ保存されていないジョブを更新しようとして失敗することがある
  await reviewJobRepo.createReviewJob(reviewJob);

  try {
    await sendMessage(
      queueUrl,
      {
        reviewJobId: reviewJob.id,
        userId: reviewJob.userId,
      },
      reviewJob.id
    );
  } catch (error) {
    // キューに入らなかったジョブは処理されないので、待ちのまま残さず失敗にする
    await reviewJobRepo
      .updateJobStatus({
        reviewJobId: reviewJob.id,
        status: REVIEW_JOB_STATUS.FAILED,
        errorDetail: "Failed to queue the review job",
      })
      .catch((statusError) =>
        console.error(
          `Failed to mark review job ${reviewJob.id} as failed:`,
          statusError
        )
      );
    throw error;
  }
};

/**
 * 再審査の元になる審査ジョブと、その結果を読み込む。
 * 本人（または管理者）のジョブで、審査が終わっていて、
 * 同じチェックリストを使っていることを確認する。
 */
export const loadRerunSource = async (params: {
  sourceReviewJobId: string;
  checkListSetId: string;
  user?: RequestUser;
  deps: {
    reviewJobRepo: ReviewJobRepository;
    reviewResultRepo?: ReviewResultRepository;
  };
}): Promise<{
  reviewJobId: string;
  results: ReviewResultDetail[];
  documents: ReviewJobDocument[];
}> => {
  const { sourceReviewJobId, checkListSetId, user, deps } = params;

  const sourceJob = await deps.reviewJobRepo.findReviewJobById({
    reviewJobId: sourceReviewJobId,
  });
  assertHasOwnerAccessOrThrow(user, sourceJob.userId, {
    api: "createReviewJob",
    resourceId: sourceReviewJobId,
    logger: console,
  });

  // 完了だけでなく、失敗・中止も元にできる。途中まで済んだ項目は引き継がれる
  if (!canReviewAgain(sourceJob.status)) {
    throw new ValidationError(
      "This review job is still running, so it cannot be reviewed again yet"
    );
  }
  if (sourceJob.checkList.id !== checkListSetId) {
    throw new ValidationError(
      "A rerun must use the same checklist set as the source review job"
    );
  }

  const reviewResultRepo =
    deps.reviewResultRepo || (await makePrismaReviewResultRepository());
  const results = await reviewResultRepo.findReviewResultsById({
    jobId: sourceReviewJobId,
    includeAllChildren: true,
  });

  return {
    reviewJobId: sourceReviewJobId,
    results,
    documents: sourceJob.documents,
  };
};

export const removeReviewJob = async (params: {
  reviewJobId: string;
  user: RequestUser;
  deps?: {
    repo?: ReviewJobRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaReviewJobRepository());

  // 取得して所有者チェックを行う
  const job = await repo.findReviewJobById({ reviewJobId: params.reviewJobId });
  assertHasOwnerAccessOrThrow(params.user, job.userId, {
    api: "removeReviewJob",
    resourceId: params.reviewJobId,
    logger: console,
  });

  await repo.deleteReviewJobById({
    reviewJobId: params.reviewJobId,
  });
};

export const modifyJobStatus = async (params: {
  reviewJobId: string;
  status: REVIEW_JOB_STATUS;
  deps?: {
    repo?: ReviewJobRepository;
  };
}): Promise<void> => {
  const repo = params.deps?.repo || (await makePrismaReviewJobRepository());
  await repo.updateJobStatus({
    reviewJobId: params.reviewJobId,
    status: params.status,
  });
};
export const getReviewJobById = async (params: {
  reviewJobId: string;
  user: RequestUser;
  deps?: {
    repo?: ReviewJobRepository;
  };
}): Promise<ReviewJobDetail> => {
  const repo = params.deps?.repo || (await makePrismaReviewJobRepository());
  const job = await repo.findReviewJobById({
    reviewJobId: params.reviewJobId,
  });

  // 所有者チェック（一般ユーザは自分のジョブのみ参照可能）
  // 公開されたジョブは他の人も開ける。直せるのは作成者だけ
  assertCanViewOrThrow(toViewer(params.user), job, {
    api: "getReviewJobById",
    logger: console,
  });

  // 直せるかどうかも一緒に返す。画面側で持ち主を判定すると規則がずれる
  return { ...job, canEdit: canEdit(params.user, job) };
};
