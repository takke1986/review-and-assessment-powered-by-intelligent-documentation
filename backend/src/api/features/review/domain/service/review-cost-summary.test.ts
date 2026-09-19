import { describe, it, expect } from "vitest";
import {
  monthKey,
  summarizeCost,
  type ReviewCostRow,
} from "./review-cost-summary";

/** 日本の時間帯。getTimezoneOffset と同じ向き */
const JST = -540;

const row = (overrides: Partial<ReviewCostRow> = {}): ReviewCostRow => ({
  id: "job-1",
  name: "審査",
  createdAt: new Date("2026-09-10T00:00:00Z"),
  totalCost: 0.01,
  totalInputTokens: 100,
  totalOutputTokens: 20,
  checkListSetId: "set-1",
  checkListSetName: "チェックリストA",
  ...overrides,
});

describe("monthKey", () => {
  it("uses the viewer's calendar, not UTC", () => {
    // 日本では2026年9月1日の朝8時。UTC ではまだ8月31日
    const earlyMorning = new Date("2026-08-31T23:00:00Z");

    expect(monthKey(earlyMorning, JST)).toBe("2026-09");
    expect(monthKey(earlyMorning, 0)).toBe("2026-08");
  });

  it("pads the month so the keys sort as text", () => {
    expect(monthKey(new Date("2026-01-15T00:00:00Z"), 0)).toBe("2026-01");
  });
});

describe("summarizeCost", () => {
  it("returns zeroes rather than dividing by zero when there is nothing", () => {
    const summary = summarizeCost([]);

    expect(summary.total).toEqual({
      totalCost: 0,
      jobCount: 0,
      averageCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    expect(summary.byMonth).toEqual([]);
    expect(summary.topJobs).toEqual([]);
  });

  it("counts a job whose cost is not recorded yet", () => {
    const summary = summarizeCost([
      row({ totalCost: 0.02 }),
      row({ id: "job-2", totalCost: null, totalInputTokens: null }),
    ]);

    // 実行中のジョブを件数から外すと、一覧と数が合わなくなる
    expect(summary.total.jobCount).toBe(2);
    expect(summary.total.totalCost).toBeCloseTo(0.02);
    expect(summary.total.averageCost).toBeCloseTo(0.01);
    // 費用が無いものは「高い順」には出さない
    expect(summary.topJobs.map((job) => job.id)).toEqual(["job-1"]);
  });

  it("puts the months in order, oldest first", () => {
    const summary = summarizeCost(
      [
        row({ createdAt: new Date("2026-09-10T00:00:00Z") }),
        row({ id: "b", createdAt: new Date("2026-07-02T00:00:00Z") }),
        row({ id: "c", createdAt: new Date("2026-08-20T00:00:00Z") }),
        row({ id: "d", createdAt: new Date("2026-08-21T00:00:00Z") }),
      ],
      JST
    );

    expect(summary.byMonth.map((m) => m.month)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(summary.byMonth[1].jobCount).toBe(2);
  });

  it("puts the most expensive checklist first", () => {
    const summary = summarizeCost([
      row({ checkListSetId: "cheap", checkListSetName: "安い", totalCost: 0.001 }),
      row({
        id: "b",
        checkListSetId: "pricey",
        checkListSetName: "高い",
        totalCost: 0.5,
      }),
      row({
        id: "c",
        checkListSetId: "pricey",
        checkListSetName: "高い",
        totalCost: 0.3,
      }),
    ]);

    expect(summary.byChecklist[0]).toMatchObject({
      checkListSetId: "pricey",
      name: "高い",
      jobCount: 2,
    });
    expect(summary.byChecklist[0].totalCost).toBeCloseTo(0.8);
  });

  it("lists at most ten jobs, the dearest first", () => {
    const rows = Array.from({ length: 15 }, (_, index) =>
      row({ id: `job-${index}`, totalCost: index / 100 })
    );

    const summary = summarizeCost(rows);

    expect(summary.topJobs).toHaveLength(10);
    expect(summary.topJobs[0].id).toBe("job-14");
    expect(summary.topJobs[9].id).toBe("job-5");
  });
});
