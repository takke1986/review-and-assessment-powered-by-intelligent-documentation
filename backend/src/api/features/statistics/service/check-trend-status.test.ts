import { describe, it, expect } from "vitest";
import {
  CHECK_TREND_STATUS,
  decideCheckTrendStatus,
} from "./check-trend-status";

const row = (overrides: Partial<Parameters<typeof decideCheckTrendStatus>[0]>) => ({
  reviewedCount: 10,
  carriedOverCount: 0,
  failRate: 0,
  averageConfidence: 0.9,
  missedCount: 0,
  overturnedToPassCount: 0,
  ...overrides,
});

describe("チェック項目の状態", () => {
  it("引き継ぎだけの項目は、審査し直していないと分かる", () => {
    expect(
      decideCheckTrendStatus(row({ reviewedCount: 0, carriedOverCount: 4 }))
    ).toBe(CHECK_TREND_STATUS.NOT_REVIEWED_RECENTLY);
  });

  it("審査も引き継ぎも無ければ、判断材料が足りない", () => {
    expect(
      decideCheckTrendStatus(row({ reviewedCount: 0, carriedOverCount: 0 }))
    ).toBe(CHECK_TREND_STATUS.INSUFFICIENT_DATA);
  });

  it("審査回数が少ないうちは、割合が高くても判断材料が足りない", () => {
    expect(
      decideCheckTrendStatus(row({ reviewedCount: 2, failRate: 1 }))
    ).toBe(CHECK_TREND_STATUS.INSUFFICIENT_DATA);
  });

  it("よく落ちて信頼度が低ければ、AI が迷っている", () => {
    expect(
      decideCheckTrendStatus(row({ failRate: 0.8, averageConfidence: 0.6 }))
    ).toBe(CHECK_TREND_STATUS.NEEDS_GUIDANCE);
  });

  it("よく落ちて信頼度が高ければ、実務で守られていない", () => {
    expect(
      decideCheckTrendStatus(row({ failRate: 0.8, averageConfidence: 0.95 }))
    ).toBe(CHECK_TREND_STATUS.OPERATIONAL_ISSUE);
  });

  it("信頼度が取れない項目は、実務側として扱う", () => {
    expect(
      decideCheckTrendStatus(row({ failRate: 0.8, averageConfidence: null }))
    ).toBe(CHECK_TREND_STATUS.OPERATIONAL_ISSUE);
  });

  it("落ちにくければ安定している", () => {
    expect(
      decideCheckTrendStatus(row({ failRate: 0.2, averageConfidence: 0.5 }))
    ).toBe(CHECK_TREND_STATUS.STABLE);
  });

  it("引き継ぎがあっても、審査していれば割合で判断する", () => {
    expect(
      decideCheckTrendStatus(
        row({ reviewedCount: 5, carriedOverCount: 3, failRate: 0.8 })
      )
    ).toBe(CHECK_TREND_STATUS.OPERATIONAL_ISSUE);
  });
});

describe("人が覆した記録からの状態", () => {
  it("AI が合格にしたものを人が2回以上不合格に直していれば、見落としている", () => {
    expect(decideCheckTrendStatus(row({ missedCount: 2 }))).toBe(
      CHECK_TREND_STATUS.MISSES_THINGS
    );
  });

  it("見落としが1回だけなら、まだ癖とは言えない", () => {
    expect(decideCheckTrendStatus(row({ missedCount: 1 }))).toBe(
      CHECK_TREND_STATUS.STABLE
    );
  });

  it("見落としは割合ではなく回数で見る（審査が多くても薄まらない）", () => {
    expect(
      decideCheckTrendStatus(row({ reviewedCount: 500, missedCount: 2 }))
    ).toBe(CHECK_TREND_STATUS.MISSES_THINGS);
  });

  it("不合格を3割以上合格に戻していれば、厳しすぎる", () => {
    expect(
      decideCheckTrendStatus(row({ reviewedCount: 10, overturnedToPassCount: 3 }))
    ).toBe(CHECK_TREND_STATUS.TOO_STRICT);
  });

  it("戻した割合が低ければ、厳しすぎるとは言わない", () => {
    expect(
      decideCheckTrendStatus(row({ reviewedCount: 10, overturnedToPassCount: 2 }))
    ).toBe(CHECK_TREND_STATUS.STABLE);
  });

  it("見落としのほうを先に出す。実害が大きいほうから直したい", () => {
    expect(
      decideCheckTrendStatus(
        row({ reviewedCount: 10, missedCount: 2, overturnedToPassCount: 5 })
      )
    ).toBe(CHECK_TREND_STATUS.MISSES_THINGS);
  });

  it("覆された記録は不合格率より優先する。不合格率は上書き後の数字なので", () => {
    expect(
      decideCheckTrendStatus(
        row({ failRate: 0.9, averageConfidence: 0.5, overturnedToPassCount: 4 })
      )
    ).toBe(CHECK_TREND_STATUS.TOO_STRICT);
  });

  it("審査回数が少ないうちは、覆されていても判断材料が足りない", () => {
    expect(
      decideCheckTrendStatus(row({ reviewedCount: 2, missedCount: 2 }))
    ).toBe(CHECK_TREND_STATUS.INSUFFICIENT_DATA);
  });
});
