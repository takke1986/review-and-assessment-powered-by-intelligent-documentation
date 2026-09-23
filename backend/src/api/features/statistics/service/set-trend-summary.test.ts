import { describe, expect, it } from "vitest";
import {
  FEW_REVIEW_JOBS,
  isActionable,
  sortSummaries,
  summarizeSets,
  type CheckItemCounts,
  type CheckListSetTrendSummary,
} from "./set-trend-summary";
import { CHECK_TREND_STATUS } from "./check-trend-status";

const item = (over: Partial<CheckItemCounts> = {}): CheckItemCounts => ({
  checkId: "c1",
  checkListSetId: "s1",
  reviewedCount: 0,
  failedCount: 0,
  carriedOverCount: 0,
  averageConfidence: null,
  missedCount: 0,
  overturnedToPassCount: 0,
  ...over,
});

const set = (
  over: Partial<Parameters<typeof summarizeSets>[0]["sets"][0]> = {}
) => ({
  id: "s1",
  name: "セット1",
  departmentId: null,
  reviewJobCount: 0,
  lastReviewedAt: null,
  ...over,
});

describe("summarizeSets", () => {
  it("末端項目の判定を合計して不合格率を出す", () => {
    const [row] = summarizeSets({
      sets: [set({ reviewJobCount: 4 })],
      items: [
        item({ checkId: "a", reviewedCount: 4, failedCount: 4 }),
        item({ checkId: "b", reviewedCount: 4, failedCount: 0 }),
      ],
    });

    expect(row.itemCount).toBe(2);
    expect(row.failRate).toBe(0.5); // 8件中4件が不合格
  });

  it("一度も審査されていなければ不合格率は null になる", () => {
    const [row] = summarizeSets({
      sets: [set()],
      items: [item({ reviewedCount: 0 })],
    });

    // 0% と「まだ分からない」は違う。0 を返すと安全なセットに見える
    expect(row.failRate).toBeNull();
    expect(row.reviewJobCount).toBe(0);
  });

  it("手を入れる価値がある項目だけを数える", () => {
    const [row] = summarizeSets({
      sets: [set({ reviewJobCount: 5 })],
      items: [
        // 落ちていて AI も確信している → 実務で守られていない
        item({
          checkId: "a",
          reviewedCount: 4,
          failedCount: 4,
          averageConfidence: 0.9,
        }),
        // 人が不合格に直している → 見落とし
        item({
          checkId: "b",
          reviewedCount: 4,
          failedCount: 1,
          missedCount: 2,
        }),
        // 落ちにくい → 安定
        item({
          checkId: "c",
          reviewedCount: 4,
          failedCount: 0,
          averageConfidence: 0.9,
        }),
        // 審査が足りない → 判断できない
        item({ checkId: "d", reviewedCount: 1, failedCount: 1 }),
      ],
    });

    expect(row.actionableCount).toBe(2);
    expect(row.missedCount).toBe(2);
  });

  it("審査回数が少ないセットは判断に足りないと印を付ける", () => {
    const few = summarizeSets({
      sets: [set({ reviewJobCount: FEW_REVIEW_JOBS - 1 })],
      items: [item({ reviewedCount: 1, failedCount: 1 })],
    })[0];
    const enough = summarizeSets({
      sets: [set({ reviewJobCount: FEW_REVIEW_JOBS })],
      items: [item({ reviewedCount: 4, failedCount: 4 })],
    })[0];

    expect(few.insufficientData).toBe(true);
    expect(enough.insufficientData).toBe(false);
  });

  it("未審査のセットには印を付けない（判断に足りないとは別の状態）", () => {
    const [row] = summarizeSets({
      sets: [set({ reviewJobCount: 0 })],
      items: [item()],
    });

    // 「未審査」は一覧側で畳む。ここで insufficientData を立てると
    // 「1回だけ審査した」ものと区別が付かなくなる
    expect(row.insufficientData).toBe(false);
  });

  it("項目を持たないセットも返す（一覧から消さない）", () => {
    const [row] = summarizeSets({ sets: [set()], items: [] });

    expect(row.checkListSetId).toBe("s1");
    expect(row.itemCount).toBe(0);
    expect(row.actionableCount).toBe(0);
  });

  it("項目を所属セットごとに振り分ける", () => {
    const rows = summarizeSets({
      sets: [set({ id: "s1" }), set({ id: "s2", name: "セット2" })],
      items: [
        item({
          checkId: "a",
          checkListSetId: "s1",
          reviewedCount: 2,
          failedCount: 2,
        }),
        item({
          checkId: "b",
          checkListSetId: "s2",
          reviewedCount: 2,
          failedCount: 0,
        }),
      ],
    });

    expect(rows.find((r) => r.checkListSetId === "s1")?.failRate).toBe(1);
    expect(rows.find((r) => r.checkListSetId === "s2")?.failRate).toBe(0);
  });
});

describe("isActionable", () => {
  it("安定と判断材料不足は手を入れる対象に含めない", () => {
    expect(isActionable(CHECK_TREND_STATUS.STABLE)).toBe(false);
    expect(isActionable(CHECK_TREND_STATUS.INSUFFICIENT_DATA)).toBe(false);
    expect(isActionable(CHECK_TREND_STATUS.NOT_REVIEWED_RECENTLY)).toBe(false);
    expect(isActionable(CHECK_TREND_STATUS.OPERATIONAL_ISSUE)).toBe(true);
    expect(isActionable(CHECK_TREND_STATUS.MISSES_THINGS)).toBe(true);
  });
});

describe("sortSummaries", () => {
  const row = (
    over: Partial<CheckListSetTrendSummary>
  ): CheckListSetTrendSummary => ({
    checkListSetId: "s",
    name: "",
    departmentId: null,
    itemCount: 0,
    reviewJobCount: 0,
    failRate: null,
    actionableCount: 0,
    insufficientData: false,
    missedCount: 0,
    overturnedToPassCount: 0,
    lastReviewedAt: null,
    ...over,
  });

  it("既定は手を入れる項目の多い順", () => {
    const sorted = sortSummaries(
      [
        row({ checkListSetId: "a", actionableCount: 1 }),
        row({ checkListSetId: "b", actionableCount: 5 }),
      ],
      "actionableCount",
      "desc"
    );

    expect(sorted.map((r) => r.checkListSetId)).toEqual(["b", "a"]);
  });

  it("値の無い行は、どちら向きでも最後に置く", () => {
    const rows = [
      row({ checkListSetId: "none", failRate: null }),
      row({ checkListSetId: "low", failRate: 0.1 }),
      row({ checkListSetId: "high", failRate: 0.9 }),
    ];

    expect(
      sortSummaries(rows, "failRate", "desc").map((r) => r.checkListSetId)
    ).toEqual(["high", "low", "none"]);
    // 昇順でも空欄が先頭に来ない。見たいものが押し出されるため
    expect(
      sortSummaries(rows, "failRate", "asc").map((r) => r.checkListSetId)
    ).toEqual(["low", "high", "none"]);
  });

  it("同じ値なら審査の多い順になる", () => {
    const sorted = sortSummaries(
      [
        row({ checkListSetId: "few", actionableCount: 2, reviewJobCount: 1 }),
        row({ checkListSetId: "many", actionableCount: 2, reviewJobCount: 9 }),
      ],
      "actionableCount",
      "desc"
    );

    expect(sorted.map((r) => r.checkListSetId)).toEqual(["many", "few"]);
  });

  it("人が覆した数では、見落としを重く見る", () => {
    const sorted = sortSummaries(
      [
        row({ checkListSetId: "loose", overturnedToPassCount: 9 }),
        row({ checkListSetId: "missed", missedCount: 1 }),
      ],
      "overturned",
      "desc"
    );

    expect(sorted.map((r) => r.checkListSetId)).toEqual(["missed", "loose"]);
  });

  it("名前は文字として並べる", () => {
    const sorted = sortSummaries(
      [row({ name: "B" }), row({ name: "A" })],
      "name",
      "asc"
    );

    expect(sorted.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("元の配列を壊さない", () => {
    const rows = [row({ actionableCount: 1 }), row({ actionableCount: 2 })];
    sortSummaries(rows, "actionableCount", "desc");

    expect(rows[0].actionableCount).toBe(1);
  });
});
