import { describe, expect, it, vi } from "vitest";
import { getCheckListSetTrends } from "./check-list-set-trends";
import type { StatisticsRepository } from "../domain/repository";
import type { CheckListSetTrendSummary } from "../service/set-trend-summary";
import type { RequestUser } from "../../../core/middleware/authorization";

const user = { userId: "u1", isAdmin: false } as RequestUser;

const row = (
  over: Partial<CheckListSetTrendSummary>
): CheckListSetTrendSummary => ({
  checkListSetId: "s",
  name: "",
  departmentId: null,
  itemCount: 0,
  reviewJobCount: 1,
  failRate: null,
  actionableCount: 0,
  insufficientData: false,
  missedCount: 0,
  overturnedToPassCount: 0,
  lastReviewedAt: null,
  ...over,
});

const makeRepo = (rows: CheckListSetTrendSummary[]) => {
  const seen: { visibleTo?: unknown } = {};
  const repo = {
    findCheckFailureTrends: vi.fn(),
    countReviewJobs: vi.fn(),
    findCheckListSetTrendSummaries: vi.fn(async (params: any) => {
      seen.visibleTo = params.visibleTo;
      return rows;
    }),
  } as unknown as StatisticsRepository;
  return { repo, seen };
};

describe("getCheckListSetTrends", () => {
  it("未審査のセットは既定で返さない", async () => {
    const { repo } = makeRepo([
      row({ checkListSetId: "reviewed", reviewJobCount: 3 }),
      row({ checkListSetId: "never", reviewJobCount: 0 }),
    ]);

    const result = await getCheckListSetTrends({ user, deps: { repo } });

    expect(result.items.map((r) => r.checkListSetId)).toEqual(["reviewed"]);
    expect(result.total).toBe(1);
  });

  it("includeUnreviewed で未審査も返す", async () => {
    const { repo } = makeRepo([
      row({ checkListSetId: "reviewed", reviewJobCount: 3 }),
      row({ checkListSetId: "never", reviewJobCount: 0 }),
    ]);

    const result = await getCheckListSetTrends({
      user,
      includeUnreviewed: true,
      deps: { repo },
    });

    expect(result.total).toBe(2);
  });

  it("名前で絞り込む", async () => {
    const { repo } = makeRepo([
      row({ checkListSetId: "a", name: "見積書チェックリスト" }),
      row({ checkListSetId: "b", name: "契約書チェックリスト" }),
    ]);

    const result = await getCheckListSetTrends({
      user,
      search: "見積",
      deps: { repo },
    });

    expect(result.items.map((r) => r.checkListSetId)).toEqual(["a"]);
  });

  it("濁点が分解された名前でも、打った文字で当たる", async () => {
    // macOS が作る名前は「カ」+ 結合濁点の分解形。打つのは合成済みの「ガ」
    const { repo } = makeRepo([
      row({ checkListSetId: "a", name: "カ\u3099イド".normalize("NFD") }),
    ]);

    const result = await getCheckListSetTrends({
      user,
      search: "ガイド",
      deps: { repo },
    });

    expect(result.items).toHaveLength(1);
  });

  it("ページで区切り、総数とページ数を返す", async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ checkListSetId: `s${i}`, actionableCount: 25 - i })
    );
    const { repo } = makeRepo(rows);

    const page2 = await getCheckListSetTrends({
      user,
      page: 2,
      limit: 10,
      deps: { repo },
    });

    expect(page2.items).toHaveLength(10);
    expect(page2.total).toBe(25);
    expect(page2.totalPages).toBe(3);
    // 並べた結果の11件目から。ページで切ったことで順位は変わらない
    expect(page2.items[0].checkListSetId).toBe("s10");
  });

  it("ページ番号と件数が範囲外でも落ちない", async () => {
    const { repo } = makeRepo([row({})]);

    const zero = await getCheckListSetTrends({
      user,
      page: 0,
      limit: 0,
      deps: { repo },
    });

    expect(zero.page).toBe(1);
    expect(zero.limit).toBeGreaterThan(0);
  });

  it("見える範囲をリポジトリに渡す", async () => {
    const { repo, seen } = makeRepo([row({})]);

    await getCheckListSetTrends({ user, deps: { repo } });

    expect(seen.visibleTo).toMatchObject({ userId: "u1", isAdmin: false });
  });

  it("並べ替えの指定が効く", async () => {
    const { repo } = makeRepo([
      row({ checkListSetId: "a", name: "B", actionableCount: 9 }),
      row({ checkListSetId: "b", name: "A", actionableCount: 1 }),
    ]);

    const byName = await getCheckListSetTrends({
      user,
      sortBy: "name",
      sortOrder: "asc",
      deps: { repo },
    });

    expect(byName.items.map((r) => r.name)).toEqual(["A", "B"]);
  });
});
