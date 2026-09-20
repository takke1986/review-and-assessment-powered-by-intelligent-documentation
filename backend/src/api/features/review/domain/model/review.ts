import {
  CheckListItemEntity,
  CheckListSetEntity,
  DEFAULT_CHECK_ITEM_IMPORTANCE,
  parseCheckItemImportance,
} from "../../../checklist/domain/model/checklist";

/**
 * 審査ジョブのステータス
 */
export enum REVIEW_JOB_STATUS {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  /** 人が途中で止めた。失敗とは分けて数える */
  CANCELLED = "cancelled",
}

/**
 * 審査結果のステータス
 */
export enum REVIEW_RESULT_STATUS {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * 審査結果の評価
 */
export enum REVIEW_RESULT {
  PASS = "pass",
  FAIL = "fail",
}

/**
 * 審査ファイルタイプ
 */
export enum REVIEW_FILE_TYPE {
  PDF = "pdf",
  IMAGE = "image",
}

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
  /** 審査が終わった項目 */
  completed: number;
  /** 審査する項目 */
  total: number;
}

/**
 * 審査した項目の数と、チェックリストの項目の数。どちらも子を持たない項目で数える。
 * 項目を選んで作ったジョブでは reviewed が total より少ない
 */
export interface CheckItemCounts {
  reviewed: number;
  total: number;
}

export interface ReviewJobEntity {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
  checkListSetId: string;
  userId?: string;
  /** この審査がどの部署の仕事か。部署を使わない運用では空 */
  departmentId?: string;
  /** 再審査の元になったジョブ */
  sourceReviewJobId?: string;
  /** 再審査で何を直したかのメモ */
  revisionNote?: string;
  documents: Array<{
    id: string;
    filename: string;
    s3Key: string;
    fileType: REVIEW_FILE_TYPE;
    /** 引き継いだ文書は元のアップロード日時を保つ。未設定なら作成時刻 */
    uploadDate?: Date;
    /** 再審査で、元のジョブから引き継いだ文書 */
    carriedFromDocumentId?: string;
    /** 再審査で、この文書が差し替えた元のジョブの文書 */
    replacesDocumentId?: string;
  }>;
  results: ReviewResultEntity[];
}

/**
 * ジョブ一覧表示用
 */
/**
 * 判定を覆した理由。
 *
 * 自由記述のコメントとは別に、集計できる形で持つ。並べたときに
 * 「何を直せばいいか」が分かる粒度にしてある
 */
export const OVERRIDE_REASON = {
  /** 基準の読み方が AI と違った。着眼点で埋められる */
  CRITERIA_INTERPRETATION: "criteria_interpretation",
  /** 文書には書いてあるが、AI が見つけられなかった／読み違えた */
  MISSED_IN_DOCUMENT: "missed_in_document",
  /** そもそもこの文書では見なくてよい項目だった */
  NOT_APPLICABLE: "not_applicable",
  /** 項目の書き方が曖昧で、どちらとも取れる */
  AMBIGUOUS_ITEM: "ambiguous_item",
  /** 上のどれでもない。コメントを読むしかない */
  OTHER: "other",
} as const;

export type OVERRIDE_REASON =
  (typeof OVERRIDE_REASON)[keyof typeof OVERRIDE_REASON];

export const isOverrideReason = (value: unknown): value is OVERRIDE_REASON =>
  typeof value === "string" &&
  (Object.values(OVERRIDE_REASON) as string[]).includes(value);

export interface ReviewJobSummary {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
  checkListSetId: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  userId?: string;
  /** この審査がどの部署の仕事か */
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
  checkItemCounts: CheckItemCounts;
  progress: ReviewJobProgress;
}

/**
 * ジョブ結果画面のジョブ情報表示用
 */
export interface ReviewJobDetail {
  id: string;
  name: string;
  status: REVIEW_JOB_STATUS;
  /** この審査がどの部署の仕事か */
  departmentId?: string;
  /** 走っている審査の実行。中止に使う。待ち行列にいる間は入らない */
  executionArn?: string;
  /**
   * 見ている人がこのジョブを直せるか（判定の変更・再審査・中止・削除）。
   * 画面側で持ち主を判定するとサーバの規則とずれるので、ここで答える
   */
  canEdit?: boolean;
  errorDetail?: string;
  hasError: boolean;
  checkList: CheckListSetEntity;
  documents: ReviewJobDocument[];
  // ジョブ作成者（所有者） - 存在しない場合もあるためオプショナル
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: number;
  /**
   * 再審査の元になったジョブと、その文書（差し替え前の文書）。
   * 元のジョブが削除されていれば無い
   */
  sourceReviewJob?: ReviewJobLink & { documents: ReviewJobDocument[] };
  /** 再審査で何を直したかのメモ */
  revisionNote?: string;
  /** このジョブを元にした再審査ジョブ（新しい順） */
  rerunJobs: ReviewJobLink[];
  checkItemCounts: CheckItemCounts;
  progress: ReviewJobProgress;
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
  uploadDate: Date;
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
  /** AI が下した判定。上書きしても変わらない。この変更より前の結果には無い */
  aiResult?: REVIEW_RESULT;
  /** 覆した理由 */
  overrideReason?: OVERRIDE_REASON;
  /** 覆した人。そのときの表示名を控える */
  overriddenBy?: string;
  /** 覆した日時。updatedAt は審査し直しでも動くので別に持つ */
  overriddenAt?: Date;
  userComment?: string;
}

/**
 * 参照元情報
 */
export interface DocumentInfo {
  documentId: string;
  filename: string;
  pageNumber?: number; // PDFで使用
}

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
  /** AI が下した判定。上書きしても変わらない。この変更より前の結果には無い */
  aiResult?: REVIEW_RESULT;
  /** 覆した理由 */
  overrideReason?: OVERRIDE_REASON;
  /** 覆した人。そのときの表示名を控える */
  overriddenBy?: string;
  /** 覆した日時。updatedAt は審査し直しでも動くので別に持つ */
  overriddenAt?: Date;
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
  reviewMeta?: any;
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number;
  /** 元のジョブにおける、同じチェック項目の結果 */
  previousResultId?: string;
  /** 審査せずに元の結果を引き継いだか */
  carriedOver?: boolean;
  /**
   * この判定を下したジョブ。引き継いだ結果にだけ入り、判定に使った文書はそのジョブにある。
   * 未設定なら、この結果のジョブで判定している
   */
  judgedInReviewJobId?: string;
}

export interface ReviewResultDetail extends ReviewResultEntity {
  checkList: CheckListItemEntity;
  hasChildren: boolean;
  /** 元のジョブでの結果。元の結果が削除されていれば無い */
  previousResult?: PreviousReviewResult;
}

export const ReviewResultDomain = (() => {
  const _parseJsonField = (value: any): any => {
    if (!value) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return undefined;
      try {
        return JSON.parse(trimmed);
      } catch {
        return undefined;
      }
    }
    return value;
  };

  const _parseExtractedText = (value: any): string[] | undefined => {
    const parsed = _parseJsonField(value);
    if (Array.isArray(parsed)) return parsed;

    // 後方互換性: プレーンテキストを配列化
    if (typeof value === "string" && value.trim() !== "") {
      return [value.trim()];
    }

    return undefined;
  };

  const _buildSourceReferencesFromImages = (
    usedImageIndexes: number[] | undefined,
    imageBuffers: Array<{
      documentId: string;
      filename: string;
      buffer: Uint8Array;
    }>
  ): SourceReference[] => {
    // usedImageIndexesが指定されている場合は、その画像のみを使用
    if (usedImageIndexes && usedImageIndexes.length > 0) {
      return usedImageIndexes
        .filter((index) => index >= 0 && index < imageBuffers.length)
        .map((index) => ({
          documentId: imageBuffers[index].documentId,
        }));
    }

    // そうでない場合は全ての画像を使用
    return imageBuffers.map((img) => ({
      documentId: img.documentId,
    }));
  };

  const _toPreviousResult = (
    previous: any
  ): PreviousReviewResult | undefined => {
    if (!previous) return undefined;
    return {
      id: previous.id,
      reviewJobId: previous.reviewJobId,
      status: previous.status as REVIEW_RESULT_STATUS,
      result: (previous.result as REVIEW_RESULT | null) ?? undefined,
      confidenceScore: previous.confidenceScore ?? undefined,
      explanation: previous.explanation ?? undefined,
      shortExplanation: previous.shortExplanation ?? undefined,
      userOverride: previous.userOverride ?? false,
      userComment: previous.userComment ?? undefined,
    };
  };

  return {
    /** 前回の結果を読み込むときに Prisma の select に渡す列 */
    previousResultSelect: {
      id: true,
      reviewJobId: true,
      status: true,
      result: true,
      confidenceScore: true,
      explanation: true,
      shortExplanation: true,
      userOverride: true,
      userComment: true,
    },

    toPreviousResult: _toPreviousResult,

    fromPrismaReviewResult: (prismaResult: any): ReviewResultEntity => {
      return {
        id: prismaResult.id,
        reviewJobId: prismaResult.reviewJobId,
        checkId: prismaResult.checkId,
        status: prismaResult.status as REVIEW_RESULT_STATUS,
        result: prismaResult.result as REVIEW_RESULT | undefined,
        confidenceScore: prismaResult.confidenceScore ?? undefined,
        explanation: prismaResult.explanation ?? undefined,
        shortExplanation: prismaResult.shortExplanation ?? undefined,
        extractedText: _parseExtractedText(prismaResult.extractedText),
        userComment: prismaResult.userComment ?? undefined,
        userOverride: prismaResult.userOverride,
        aiResult: (prismaResult.aiResult as REVIEW_RESULT) ?? undefined,
        overrideReason:
          (prismaResult.overrideReason as OVERRIDE_REASON) ?? undefined,
        overriddenBy: prismaResult.overriddenBy ?? undefined,
        overriddenAt: prismaResult.overriddenAt ?? undefined,
        createdAt: prismaResult.createdAt,
        updatedAt: prismaResult.updatedAt,
        reviewMeta: prismaResult.reviewMeta as any,
        inputTokens: prismaResult.inputTokens ?? undefined,
        outputTokens: prismaResult.outputTokens ?? undefined,
        totalCost: prismaResult.totalCost
          ? Number(prismaResult.totalCost)
          : undefined,
        sourceReferences: _parseJsonField(prismaResult.sourceReferences),
        externalSources: _parseJsonField(prismaResult.externalSources),
        previousResultId: prismaResult.previousResultId ?? undefined,
        carriedOver: prismaResult.carriedOver ?? false,
        judgedInReviewJobId: prismaResult.judgedInReviewJobId ?? undefined,
      };
    },

    fromPrismaReviewResultDetail: (
      prismaResult: any,
      hasChildren: boolean
    ): ReviewResultDetail => {
      const baseEntity =
        ReviewResultDomain.fromPrismaReviewResult(prismaResult);

      return {
        ...baseEntity,
        checkList: {
          id: prismaResult.checkList.id,
          setId: prismaResult.checkList.checkListSetId,
          name: prismaResult.checkList.name,
          description: prismaResult.checkList.description ?? undefined,
          parentId: prismaResult.checkList.parentId ?? undefined,
          importance:
            parseCheckItemImportance(prismaResult.checkList.importance) ??
            DEFAULT_CHECK_ITEM_IMPORTANCE,
        },
        hasChildren,
        previousResult: _toPreviousResult(prismaResult.previousResult),
      };
    },

    fromOverrideRequest: (params: {
      current: ReviewResultDetail;
      result: REVIEW_RESULT;
      userComment: string;
      overrideReason?: OVERRIDE_REASON;
      /** 覆した人の表示名。分からなければ残さない */
      overriddenBy?: string;
    }): ReviewResultDetail => {
      const { current, result, userComment, overrideReason, overriddenBy } =
        params;
      return {
        ...current,
        result,
        userComment,
        overrideReason,
        overriddenBy,
        overriddenAt: new Date(),
        userOverride: true,
        // AI の判定は上書きで変えない。まだ入っていない結果（この変更より
        // 前に審査したもの）でも、まだ誰も上書きしていなければ、いまの
        // result が AI の判定そのもの。そこだけは拾っておく
        aiResult:
          current.aiResult ??
          (current.userOverride ? undefined : current.result),
        updatedAt: new Date(),
      };
    },

    fromReviewData: (params: {
      current: ReviewResultDetail;
      result: REVIEW_RESULT;
      confidenceScore: number;
      explanation: string;
      shortExplanation: string;

      // 共通フィールド
      documents: DocumentInfo[];
      reviewType: "PDF" | "IMAGE";
      verificationDetails?: {
        sourcesDetails: Array<{
          toolUseId: string;
          toolName: string;
          input?: any;
          output?: string;
          status?: "success" | "error" | "unknown";
        }>;
      };
      reviewMeta?: any;
      inputTokens?: number;
      outputTokens?: number;
      totalCost?: number;

      // タイプ固有フィールド
      typeSpecificData?: {
        // PDF固有データ
        extractedText?: string[];

        // 画像固有データ
        usedImageIndexes?: number[];
        boundingBoxes?: Array<{
          imageIndex: number;
          label: string;
          coordinates: [number, number, number, number];
        }>;
      };
    }): ReviewResultEntity => {
      const {
        current,
        result: reviewResult,
        confidenceScore,
        explanation,
        shortExplanation,
        documents,
        reviewType,
        verificationDetails,
        typeSpecificData,
      } = params;

      let sourceReferences: SourceReference[] = [];

      // レビュータイプによる分岐
      if (reviewType === "PDF") {
        // PDFのソース参照作成
        // ページは PDF にだけある。Word・Excel・PowerPoint の文書には付けない
        sourceReferences = documents.map((doc) => ({
          documentId: doc.documentId,
          pageNumber: doc.pageNumber,
        }));
      } else {
        // IMAGE
        const { usedImageIndexes, boundingBoxes = [] } = typeSpecificData || {};

        // 使用された画像のみを対象とするか、すべての画像を対象とするか
        if (usedImageIndexes && usedImageIndexes.length > 0) {
          sourceReferences = usedImageIndexes
            .filter((index) => index >= 0 && index < documents.length)
            .map((index) => ({
              documentId: documents[index].documentId,
            }));
        } else {
          sourceReferences = documents.map((doc) => ({
            documentId: doc.documentId,
          }));
        }

        // バウンディングボックスの処理
        if (boundingBoxes && boundingBoxes.length > 0) {
          boundingBoxes.forEach((box) => {
            const imageIndex = box.imageIndex;
            if (imageIndex >= 0 && imageIndex < documents.length) {
              const documentId = documents[imageIndex].documentId;
              const existingRef = sourceReferences.find(
                (ref) => ref.documentId === documentId
              );

              if (existingRef) {
                existingRef.boundingBox = {
                  label: box.label,
                  coordinates: box.coordinates,
                };
              } else {
                sourceReferences.push({
                  documentId,
                  boundingBox: {
                    label: box.label,
                    coordinates: box.coordinates,
                  },
                });
              }
            }
          });
        }
      }

      // 共通返却値
      const resultEntity: ReviewResultEntity = {
        ...current,
        status: REVIEW_RESULT_STATUS.COMPLETED,
        result: reviewResult,
        confidenceScore,
        explanation,
        shortExplanation,
        sourceReferences,
        externalSources: verificationDetails?.sourcesDetails || undefined,
        userOverride: false,
        // AI が下した判定として控える。人が上書きしても、これは変わらない。
        // 審査し直したときは、そのときの AI の判定で置き換わる
        aiResult: reviewResult,
        // 判定をやり直したので、前回覆された記録は持ち越さない
        overrideReason: undefined,
        overriddenBy: undefined,
        overriddenAt: undefined,
        updatedAt: new Date(),
        reviewMeta: params.reviewMeta,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalCost: params.totalCost,
      };

      // PDFの場合のみ抽出テキストを追加
      if (reviewType === "PDF" && typeSpecificData?.extractedText) {
        resultEntity.extractedText = typeSpecificData.extractedText;
      }

      return resultEntity;
    },

    parseSourceReferences: (
      documentId: string,
      pageNumberOrIndices?: string | number
    ): SourceReference[] => {
      if (pageNumberOrIndices === undefined) {
        return [{ documentId }];
      }

      // 文字列の場合（カンマ区切りの可能性あり）
      if (typeof pageNumberOrIndices === "string") {
        // カンマ区切りの場合は複数の参照元を作成
        if (pageNumberOrIndices.includes(",")) {
          return pageNumberOrIndices.split(",").map((index) => ({
            documentId,
            pageNumber: parseInt(index.trim(), 10),
          }));
        }
        // 単一の値の場合
        return [
          {
            documentId,
            pageNumber: parseInt(pageNumberOrIndices, 10),
          },
        ];
      }

      // 数値の場合
      return [
        {
          documentId,
          pageNumber: pageNumberOrIndices,
        },
      ];
    },
  };
})();
