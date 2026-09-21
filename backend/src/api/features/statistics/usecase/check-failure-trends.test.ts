import { describe, expect, it, vi } from "vitest";
import { getCheckFailureTrends } from "./check-failure-trends";
import { ForbiddenError } from "../../../core/errors/application-errors";

const trendRow = {
  checkId: "check-1",
  name: "安全衛生責任者の記載",
  reviewedCount: 4,
  failedCount: 3,
  failRate: 0.75,
  averageConfidence: 0.6,
  lastFailedAt: new Date("2026-09-16T00:00:00Z"),
};

const repo = (rows = [trendRow], jobCount = 5) => ({
  findCheckFailureTrends: vi.fn().mockResolvedValue(rows),
  countReviewJobs: vi.fn().mockResolvedValue(jobCount),
});

describe("getCheckFailureTrends", () => {
  it("returns the rows and how many jobs they come from", async () => {
    const statisticsRepo = repo();
    const checkRepo = {
      findCheckListSetOwner: vi.fn().mockResolvedValue("u-1"),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({ userId: "u-1" }),
    };

    const trends = await getCheckFailureTrends({
      checkListSetId: "set-1",
      user: { userId: "u-1", isAdmin: false },
      deps: { repo: statisticsRepo as never, checkRepo: checkRepo as never },
    });

    expect(trends).toEqual({ reviewJobCount: 5, items: [trendRow] });
    expect(statisticsRepo.findCheckFailureTrends).toHaveBeenCalledWith({
      checkListSetId: "set-1",
    });
  });

  it("refuses someone else's checklist", async () => {
    const checkRepo = {
      findCheckListSetOwner: vi.fn().mockResolvedValue("u-1"),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({ userId: "u-1" }),
    };

    await expect(
      getCheckFailureTrends({
        checkListSetId: "set-1",
        user: { userId: "u-2", isAdmin: false },
        deps: { repo: repo() as never, checkRepo: checkRepo as never },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets an admin read it", async () => {
    const checkRepo = {
      findCheckListSetOwner: vi.fn().mockResolvedValue("u-1"),
      findCheckListSetDetailById: vi.fn().mockResolvedValue({ userId: "u-1" }),
    };

    const trends = await getCheckFailureTrends({
      checkListSetId: "set-1",
      user: { userId: "admin-1", isAdmin: true },
      deps: { repo: repo() as never, checkRepo: checkRepo as never },
    });

    expect(trends.items).toHaveLength(1);
  });
});
