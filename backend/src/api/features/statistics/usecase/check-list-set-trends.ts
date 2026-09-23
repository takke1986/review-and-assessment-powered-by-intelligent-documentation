import { toViewer } from "../../../core/access/visibility";
import { RequestUser } from "../../../core/middleware/authorization";
import {
  StatisticsRepository,
  makePrismaStatisticsRepository,
} from "../domain/repository";
import {
  CheckListSetTrendSummary,
  SetTrendSortKey,
  sortSummaries,
} from "../service/set-trend-summary";

export interface CheckListSetTrends {
  items: CheckListSetTrendSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * チェックリストを横断した傾向の一覧。
 *
 * 並べ替えとページ送りを画面側でやらずサーバでやるのは、既存の一覧
 * （CheckListPage）と操作が同じになるようにするため。件数が増えたときに
 * 画面の作りを変えずに済む。
 *
 * 集計そのものはセット数に比例しない問い合わせで済むので、全件を集めてから
 * 並べて切る。ここで切らずに画面へ全件返すと、セットが増えたときに
 * 通信量だけが伸びる。
 */
export const getCheckListSetTrends = async (params: {
  user: RequestUser;
  page?: number;
  limit?: number;
  sortBy?: SetTrendSortKey;
  sortOrder?: "asc" | "desc";
  search?: string;
  /** 審査が1回も無いセットを含めるか。既定は含めない */
  includeUnreviewed?: boolean;
  deps?: { repo?: StatisticsRepository };
}): Promise<CheckListSetTrends> => {
  const repo = params.deps?.repo || (await makePrismaStatisticsRepository());
  const all = await repo.findCheckListSetTrendSummaries({
    visibleTo: toViewer(params.user),
  });

  // 名前での絞り込み。合成方法をそろえてから比べる。
  // macOS が作る名前は「カ」+ 結合濁点の分解形で、打つ文字は合成済みの「ガ」
  const needle = (params.search ?? "").trim().normalize("NFC").toLowerCase();
  const matched = needle
    ? all.filter((row) =>
        row.name.normalize("NFC").toLowerCase().includes(needle)
      )
    : all;

  // 未審査は既定で畳む。傾向を見る対象が無いため
  const visible = params.includeUnreviewed
    ? matched
    : matched.filter((row) => row.reviewJobCount > 0);

  const sorted = sortSummaries(
    visible,
    params.sortBy ?? "actionableCount",
    params.sortOrder ?? "desc"
  );

  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 10));
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;

  return {
    items: sorted.slice(start, start + limit),
    total,
    page,
    limit,
    totalPages,
  };
};
