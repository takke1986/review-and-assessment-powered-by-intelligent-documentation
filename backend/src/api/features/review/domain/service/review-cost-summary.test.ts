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
  departmentId: null,
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

describe("部署ごとの費用", () => {
  it("部署ごとに足し合わせ、高い順に並べる", () => {
    const summary = summarizeCost([
      row({ departmentId: "sales", totalCost: 0.1 }),
      row({ id: "b", departmentId: "legal", totalCost: 0.5 }),
      row({ id: "c", departmentId: "sales", totalCost: 0.2 }),
    ]);

    expect(summary.byDepartment.map((d) => d.departmentId)).toEqual([
      "legal",
      "sales",
    ]);
    expect(summary.byDepartment[1]).toMatchObject({
      departmentId: "sales",
      jobCount: 2,
    });
    expect(summary.byDepartment[1].totalCost).toBeCloseTo(0.3);
  });

  it("部署の付いていない審査は、どこにも足さない", () => {
    // 「未所属」という部署があるように見せると、実在する部署と並んで紛らわしい
    const summary = summarizeCost([
      row({ departmentId: null, totalCost: 0.4 }),
      row({ id: "b", departmentId: "sales", totalCost: 0.1 }),
    ]);

    expect(summary.byDepartment).toHaveLength(1);
    // 総額には入る。使った費用であることに変わりはない
    expect(summary.total.totalCost).toBeCloseTo(0.5);
  });
  it("部署の付いていない審査は、部署の内訳に入れず別に数える", () => {
    // 「未所属」という部署があるように見せると、実在する部署と並んで
    // 紛らわしい。かといって黙って落とすと、内訳を足しても合計に届かない
    // 理由が分からなくなる
    const summary = summarizeCost([
      row({ departmentId: "営業部", totalCost: 3 }),
      row({ departmentId: null, totalCost: 5 }),
      row({ departmentId: null, totalCost: 2 }),
    ]);

    expect(summary.byDepartment).toEqual([
      { departmentId: "営業部", totalCost: 3, jobCount: 1 },
    ]);
    expect(summary.withoutDepartment).toEqual({ totalCost: 7, jobCount: 2 });
    // 合計には入っている
    expect(summary.total.totalCost).toBe(10);
    expect(summary.total.jobCount).toBe(3);
  });

  it("部署が全部付いていれば、部署なしは0になる", () => {
    const summary = summarizeCost([
      row({ departmentId: "営業部", totalCost: 3 }),
      row({ departmentId: "法務部", totalCost: 4 }),
    ]);

    expect(summary.withoutDepartment).toEqual({ totalCost: 0, jobCount: 0 });
  });
});
