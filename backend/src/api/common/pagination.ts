import { PaginationParams, PaginatedResponse } from "./types";

/**
 * 一覧の共通の指定と組み立て
 *
 * 4つの一覧（審査・チェックリスト・ツール設定・プロンプト）で、
 * 指定の受け取りとページの組み立てが同じ形をしている。既定値や
 * totalPages の式が各所に散ると、片方だけ直したときに食い違うので、
 * ここに集める。並べ替えの対応（関連の件数で並べるなど）は機能ごとに
 * 違うので、列名と向きだけを返して、あとは呼ぶ側に任せる。
 */

/** 名前で絞るのは4つの一覧すべて同じなので、共通の指定に含める */
export interface ListParams extends PaginationParams {
  /** 名前の一部。数が増えると一覧から探せないため */
  search?: string;
}

const DEFAULT_LIMIT = 10;

/**
 * クエリから一覧の指定を作る。
 *
 * クエリの値は文字列で届くので数値にそろえる。並べ替えの列は、そのまま
 * Prisma に渡すと存在しない列でエラーになるため、許した列だけを通す。
 */
export const parseListQuery = (
  query: {
    page?: number | string;
    limit?: number | string;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  },
  allowedSortFields: readonly string[],
  defaultSortBy: string
): ListParams => ({
  page: Number(query.page) || 1,
  limit: Number(query.limit) || DEFAULT_LIMIT,
  sortBy: allowedSortFields.includes(query.sortBy ?? "")
    ? query.sortBy
    : defaultSortBy,
  sortOrder: query.sortOrder === "asc" ? "asc" : "desc",
  search: query.search,
});

/** 指定を Prisma に渡す形にそろえる。既定値はここだけで持つ */
export const resolvePaging = (params: ListParams, defaultSortBy: string) => {
  const page = Number(params.page) || 1;
  const limit = Number(params.limit) || DEFAULT_LIMIT;
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
    sortBy: params.sortBy || defaultSortBy,
    sortOrder: params.sortOrder ?? ("desc" as const),
  };
};

/** 一覧の応答を組み立てる */
export const toPaginatedResponse = <T>(
  items: T[],
  total: number,
  paging: { page: number; limit: number }
): PaginatedResponse<T> => ({
  items,
  total,
  page: paging.page,
  limit: paging.limit,
  totalPages: Math.ceil(total / paging.limit),
});
