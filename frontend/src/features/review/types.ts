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
  /** 人が途中で止めた。失敗とは分けて見せる */
  CANCELLED = "cancelled",
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
/** 審査が終わっていない（待機中か処理中の）ジョブか */
export const isJobRunning = (status: REVIEW_JOB_STATUS) =>
  status === REVIEW_JOB_STATUS.PENDING ||
  status === REVIEW_JOB_STATUS.PROCESSING;

export enum REVIEW_RESULT {
  PASS = "pass",
  FAIL = "fail",
}

/**
 * 判定を覆した理由。バックエンドの OVERRIDE_REASON と同じ値にする。
 * 傾向で「AI のどこが外れたか」を読むために使う
 */
export enum OVERRIDE_REASON {
  /** 基準の読み方が AI と違った */
  CRITERIA_INTERPRETATION = "criteria_interpretation",
  /** 文書には書いてあるが AI が見つけられなかった */
  MISSED_IN_DOCUMENT = "missed_in_document",
  /** そもそもこの文書では見なくてよい項目だった */
  NOT_APPLICABLE = "not_applicable",
  /** 項目の書き方が曖昧で、どちらとも取れる */
  AMBIGUOUS_ITEM = "ambiguous_item",
  OTHER = "other",
}

/** 選び方の順。よくあるものを上に置く */
export const OVERRIDE_REASONS: OVERRIDE_REASON[] = [
  OVERRIDE_REASON.CRITERIA_INTERPRETATION,
  OVERRIDE_REASON.MISSED_IN_DOCUMENT,
  OVERRIDE_REASON.AMBIGUOUS_ITEM,
  OVERRIDE_REASON.NOT_APPLICABLE,
  OVERRIDE_REASON.OTHER,
];

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
  /**
   * この審査をどの部署の仕事として記録するか。兼務のときだけ送る。
   * 所属が1つならサーバが決める
   */
  /** 審査を始めた人の表示名。属性が無い利用者や、機能より前の審査は空 */
  userName?: string;
  departmentId?: string;
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
  /** AI の判定と違えたときだけ送る */
  overrideReason?: OVERRIDE_REASON;
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
    /** サーバが拡張子から決めた Content-Type。この値で署名されている */
    contentType?: string;
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
  /** この審査がどの部署の仕事か。部署を使わない運用では無い */
  /** 審査を始めた人の表示名。属性が無い利用者や、機能より前の審査は空 */
  userName?: string;
  departmentId?: string;
  /** 実行中や失敗したジョブには入らない */
  totalCost?: number;
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
  /** この審査がどの部署の仕事か。部署を使わない運用では無い */
  /** 審査を始めた人の表示名。属性が無い利用者や、機能より前の審査は空 */
  userName?: string;
  departmentId?: string;
  /**
   * このジョブを直せるか（判定の変更・再審査・中止・削除）。
   * 持ち主かどうかはサーバが答える。画面側で判定すると規則がずれる
   */
  canEdit?: boolean;
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
  /** 先に読み取った結果の状態。読み取りを通っていない書類には無い */
  reading?: DocumentReading;
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
  /** PDF のページ番号。PDF 以外には付かない */
  pageNumber?: number;
  /** 道具で読んだ Office の節番号 */
  section?: number;
  /** 書類の中のどこか。"Slide 3" や "Sheet: 売上高" など */
  locationLabel?: string;
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
  /** AI が下した判定。上書きしても変わらない。古い結果には無い */
  aiResult?: REVIEW_RESULT;
  /** 覆した理由 */
  overrideReason?: OVERRIDE_REASON;
  /** 覆した人。そのときの表示名 */
  overriddenBy?: string;
  /** 覆した日時 */
  overriddenAt?: string;
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
    /** 使ったモデル（保存の前に model_id から直された名前） */
    modelId?: string;
    // 審査処理は snake_case で書くが、保存の前に camelCase に直される
    // （post-review-item.ts の convertSnakeToCamelCase）。画面は camelCase で読む。
    // 以前は snake_case で読んでいて、画像の上限の注意が一度も出ていなかった
    /** 実際に目で見た画像の枚数 */
    imagesSeen?: number;
    /** 1項目で見られる枚数 */
    imageLimit?: number;
    /** 上限に達して、それ以上は見られなかったか */
    imageLimitReached?: boolean;
    /**
     * 書類ごとに、全体のうちどれだけの本文を読んだか（道具で読んだときだけ）。
     * 検索は全体を対象にするので、読んでいない部分も検索はされている
     */
    coverage?: Array<{
      file: string;
      unit: "page" | "section";
      total: number;
      read: number;
      /** 読んでいない範囲。"21-99, 101" の形。全部読んだら "none" */
      unread: string;
    }>;
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
/** 先に読み取った結果の状態 */
export const READING_STATUS = {
  /** ページを全部読めた */
  COMPLETED: "completed",
  /** 一部のページが読めなかった */
  PARTIAL: "partial",
  /** ページはあったが1枚も読めなかった */
  FAILED: "failed",
  /** 読むページが無かった（Office のようにページを持たない書類） */
  NO_PAGES: "no_pages",
  /** 先読みが要らなかった（小さい書類。審査時に元のファイルを直接渡す） */
  NOT_NEEDED: "not_needed",
} as const;

export type ReadingStatus =
  (typeof READING_STATUS)[keyof typeof READING_STATUS];

export interface DocumentReading {
  status: ReadingStatus;
  /** 読めなかったページ。審査は続くが中身は分かっていない */
  pagesNotRead: number[];
}

export interface CheckListItemEntity {
  id: string;
  parentId?: string;
  setId: string;
  name: string;
  description?: string;
  /** 重要度を返さない API（この変更より前のバックエンド）では無い */
  importance?: CHECK_ITEM_IMPORTANCE;
}
