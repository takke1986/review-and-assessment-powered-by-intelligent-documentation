/**
 * Review feature type definitions
 * These types correspond to the backend API endpoints in backend/src/api/features/review/routes
 */

import { ApiResponse } from "../../types/api";
import { CHECK_ITEM_IMPORTANCE } from "../checklist/types";

// Enum types
/**
 * Review job status enum
 */
export enum REVIEW_JOB_STATUS {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Review result status enum
 */
export enum REVIEW_RESULT_STATUS {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Review result enum
 */
export enum REVIEW_RESULT {
  PASS = "pass",
  FAIL = "fail",
}

/**
 * Review file type enum
 */
export enum REVIEW_FILE_TYPE {
  PDF = "pdf",
  IMAGE = "image",
}

// Request types

/**
 * Request type for getting a presigned URL for review document upload
 * POST /documents/review/presigned-url
 */
export interface GetReviewPresignedUrlRequest {
  filename: string;
  contentType: string;
}

/**
 * Request type for getting presigned URLs for multiple image uploads
 * POST /documents/review/images/presigned-url
 */
export interface GetReviewImagesPresignedUrlRequest {
  filenames: string[];
  contentTypes: string[];
}

/**
 * Request type for creating a review job
 * POST /review-jobs
 */
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
  mcpServerName?: string;
  /** 審査するチェック項目。省略するとすべての項目を審査する */
  checkIds?: string[];
  /**
   * 再審査の元になる審査ジョブ。指定すると、checkIds の項目（省略時は元のジョブで
   * 不合格だった項目）だけを審査し、それ以外は元の結果を引き継ぐ
   */
  sourceReviewJobId?: string;
  /** 再審査で何を直したかのメモ（任意） */
  revisionNote?: string;
  /** 再審査で、元のジョブから引き継ぐ文書 */
  keptDocumentIds?: string[];
}

/**
 * Request type for overriding a review result
 * PUT /review-jobs/:jobId/results/:resultId
 */
export interface OverrideReviewResultRequest {
  result: REVIEW_RESULT;
  userComment: string;
}

// Response types

/**
 * Response type for getting all review jobs
 * GET /review-jobs
 */
export type GetAllReviewJobsResponse = ApiResponse<{
  items: ReviewJobSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}>;

/**
 * Response type for getting a review job detail
 * GET /review-jobs/:jobId
 */
export type GetReviewJobDetailResponse = ApiResponse<ReviewJobDetail>;

/**
 * Response type for getting a presigned URL for review document upload
 * POST /documents/review/presigned-url
 */
export type GetReviewPresignedUrlResponse = ApiResponse<{
  url: string;
  key: string;
  documentId: string;
}>;

/**
 * Response type for getting presigned URLs for multiple image uploads
 * POST /documents/review/images/presigned-url
 */
export type GetReviewImagesPresignedUrlResponse = ApiResponse<{
  files: Array<{
    url: string;
    key: string;
    filename: string;
    documentId: string;
  }>;
}>;

/**
 * Response type for deleting a review document
 * DELETE /documents/review/:key
 */
export type DeleteReviewDocumentResponse = ApiResponse<{
  deleted: boolean;
}>;

/**
 * Response type for creating a review job
 * POST /review-jobs
 */
export type CreateReviewJobResponse = ApiResponse<Record<string, never>>;

/**
 * Response type for deleting a review job
 * DELETE /review-jobs/:id
 */
export type DeleteReviewJobResponse = ApiResponse<Record<string, never>>;

/**
 * Response type for getting review result items
 * GET /review-jobs/:jobId/results/items
 */
export type GetReviewResultItemsResponse = ApiResponse<ReviewResultDetail[]>;

/**
 * Response type for overriding a review result
 * PUT /review-jobs/:jobId/results/:resultId
 */
export type OverrideReviewResultResponse = ApiResponse<Record<string, never>>;

// Model types

/**
 * Review job stats model
 */
export interface ReviewJobStats {
  total: number;
  passed: number;
  failed: number;
  processing: number;
}

/**
 * 審査の進み具合。子を持たない項目（審査する項目）で数える
 */
export interface ReviewJobProgress {
  completed: number;
  total: number;
}

/**
 * Review job entity model
 */
export interface ReviewJobEntity {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
  documentId: string;
  checkListSetId: string;
  userId?: string;
  filename: string;
  s3Key: string;
  fileType: REVIEW_FILE_TYPE;
  imageFiles?: Array<{
    filename: string;
    s3Key: string;
  }>;
  results: ReviewResultEntity[];
}

/**
 * 審査した項目の数と、チェックリストの項目の数。どちらも子を持たない項目で数える。
 * 項目を選んで作ったジョブでは reviewed が total より少ない
 */
export interface CheckItemCounts {
  reviewed: number;
  total: number;
}

/**
 * Review job summary model (for list view)
 */
export interface ReviewJobSummary {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
  checkListSetId: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  userId?: string;
  documents: Array<{
    id: string;
    filename: string;
    s3Path: string;
    fileType: REVIEW_FILE_TYPE;
  }>;
  checkListSet: {
    id: string;
    name: string;
  };
  stats: ReviewJobStats;
  checkItemCounts?: CheckItemCounts;
  /** 進み具合を返さない API（この変更より前のバックエンド）では無い */
  progress?: ReviewJobProgress;
}

/**
 * Review job detail model (for detail view)
 */
export interface ReviewJobDetail {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
  errorDetail?: string;
  hasError: boolean;
  checkList: {
    id: string;
    name: string;
    description?: string;
    documents: {
      id: string;
      filename: string;
      s3Key: string;
      fileType: string;
      uploadDate: Date;
      status: string;
    }[];
  };
  documents: ReviewJobDocument[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: number;
  /** 再審査の元になったジョブと、その文書（差し替え前の文書） */
  sourceReviewJob?: ReviewJobLink & { documents?: ReviewJobDocument[] };
  /** 再審査で何を直したかのメモ */
  revisionNote?: string;
  /** このジョブを元にした再審査ジョブ（新しい順） */
  rerunJobs?: ReviewJobLink[];
  checkItemCounts?: CheckItemCounts;
  /** 進み具合を返さない API（この変更より前のバックエンド）では無い */
  progress?: ReviewJobProgress;
}

/**
 * 再審査でつながったジョブへのリンク
 */
export interface ReviewJobLink {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
  createdAt: Date;
  revisionNote?: string;
}

/**
 * 審査ジョブの文書
 */
export interface ReviewJobDocument {
  id: string;
  filename: string;
  s3Path: string;
  fileType: REVIEW_FILE_TYPE;
  /** 修正版は同じ名前で上げることが多いので、区別に使う */
  uploadDate?: Date;
  /** 再審査で、元のジョブから引き継いだ文書 */
  carriedFromDocumentId?: string;
  /** 再審査で、この文書が差し替えた元のジョブの文書 */
  replacesDocumentId?: string;
}

/**
 * 再審査の元になったジョブでの、同じチェック項目の結果の要約
 */
export interface PreviousReviewResult {
  id: string;
  reviewJobId: string;
  status: REVIEW_RESULT_STATUS;
  result?: REVIEW_RESULT;
  confidenceScore?: number;
  explanation?: string;
  shortExplanation?: string;
  userOverride: boolean;
  userComment?: string;
}

/**
 * Review result entity model
 */
/**
 * 参照元情報
 */
export interface SourceReference {
  documentId: string;
  pageNumber?: number;
  boundingBox?: {
    label: string;
    coordinates: [number, number, number, number]; // [x1, y1, x2, y2]
  };
}

export interface ReviewResultEntity {
  id: string;
  reviewJobId: string;
  checkId: string;
  status: REVIEW_RESULT_STATUS;
  result?: REVIEW_RESULT;
  confidenceScore?: number;
  explanation?: string;
  shortExplanation?: string;
  extractedText?: string[];
  userComment?: string;
  userOverride: boolean;
  createdAt: Date;
  updatedAt: Date;
  sourceReferences?: SourceReference[];
  externalSources?: Array<{
    toolUseId: string;
    toolName: string;
    input?: any;
    output?: string;
    status?: "success" | "error" | "unknown";
  }>;
  reviewMeta?: {
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    input_cost: number;
    output_cost: number;
    total_cost: number;
    pricing: {
      input_per_1k: number;
      output_per_1k: number;
    };
    duration_seconds: number;
    timestamp: string;
  };
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number;
}

/**
 * Review result detail model (includes checklist item)
 */
export interface ReviewResultDetail extends ReviewResultEntity {
  checkList: CheckListItemEntity;
  hasChildren: boolean;
  /** 元のジョブにおける、同じチェック項目の結果のID */
  previousResultId?: string;
  /** 審査せずに元の結果を引き継いだか */
  carriedOver?: boolean;
  /**
   * この判定を下したジョブ。引き継いだ結果にだけ入り、判定に使った文書はそのジョブにある。
   * 未設定なら、この結果のジョブで判定している
   */
  judgedInReviewJobId?: string;
  /** 元のジョブでの結果。元の結果が削除されていれば無い */
  previousResult?: PreviousReviewResult;
}

/**
 * Checklist item entity model (imported from checklist feature)
 */
export interface CheckListItemEntity {
  id: string;
  parentId?: string;
  setId: string;
  name: string;
  description?: string;
  /** 重要度を返さない API（この変更より前のバックエンド）では無い */
  importance?: CHECK_ITEM_IMPORTANCE;
}
