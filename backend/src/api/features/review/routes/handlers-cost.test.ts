import { describe, it, expect, vi, beforeEach } from "vitest";
import { getReviewCostSummaryHandler } from "./handlers";
import { getReviewCostSummary } from "../usecase/review-job";

vi.mock("../usecase/review-job", () => ({
  getReviewCostSummary: vi.fn(),
}));

describe("getReviewCostSummaryHandler", () => {
  const call = async (query: Record<string, unknown>) => {
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await getReviewCostSummaryHandler(
      { query, user: { userId: "u-1", isAdmin: false } } as any,
      reply as any
    );
    return vi.mocked(getReviewCostSummary).mock.calls.at(-1)?.[0];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReviewCostSummary).mockResolvedValue({
      total: {
        totalCost: 0,
        jobCount: 0,
        averageCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
      byMonth: [],
      byChecklist: [],
      topJobs: [],
    });
  });

  it("passes the period through as dates", async () => {
    const params = await call({
      createdFrom: "2026-09-01T00:00:00.000Z",
      createdTo: "2026-09-30T23:59:59.999Z",
    });

    expect(params?.createdFrom?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(params?.createdTo?.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });

  it("ignores a date it cannot read, rather than returning nothing", async () => {
    const params = await call({ createdFrom: "先月", createdTo: "" });

    // 不正な値で0件になるより、全期間を出して気づいてもらう方がいい
    expect(params?.createdFrom).toBeUndefined();
    expect(params?.createdTo).toBeUndefined();
  });

  it("passes the viewer's time zone so the months line up with their calendar", async () => {
    const params = await call({ tzOffsetMinutes: "-540" });

    expect(params?.tzOffsetMinutes).toBe(-540);
  });

  it("falls back to UTC when the time zone cannot be read", async () => {
    expect((await call({}))?.tzOffsetMinutes).toBe(0);
    expect((await call({ tzOffsetMinutes: "とうきょう" }))?.tzOffsetMinutes).toBe(
      0
    );
  });
});
