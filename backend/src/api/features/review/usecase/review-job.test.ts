import { describe, it, expect, vi } from "vitest";
import { getAllReviewJobs } from "./review-job";
import type { PaginatedResponse } from "../../../common/types";
import type { ReviewJobSummary } from "../domain/model/review";
import type { ReviewJobRepository } from "../domain/repository";

const emptyResult: PaginatedResponse<ReviewJobSummary> = {
  items: [],
  total: 0,
  page: 1,
  limit: 10,
  totalPages: 0,
};

const createReviewJobRepositoryMock = (): ReviewJobRepository => ({
  findAllReviewJobs: vi.fn().mockResolvedValue(emptyResult),
  findReviewJobById: vi.fn(),
  createReviewJob: vi.fn(),
  deleteReviewJobById: vi.fn(),
  updateJobStatus: vi.fn(),
  updateJobCostInfo: vi.fn(),
  summarizeReviewCost: vi.fn(),
});

describe("getAllReviewJobs", () => {
  it("tells the repository who is looking, so shared jobs can be included", async () => {
    const repo = createReviewJobRepositoryMock();

    await getAllReviewJobs({
      page: 1,
      limit: 10,
      user: { userId: "user-1", isAdmin: false },
      deps: { repo },
    });

    // 自分のものだけに絞るのではなく、見える範囲を渡す。
    // 絞り込みそのものは visibilityFilter が決める
    expect(repo.findAllReviewJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleTo: { userId: "user-1", isAdmin: false },
      })
    );
  });

  it("passes the admin through too; the filter decides they see everything", async () => {
    const repo = createReviewJobRepositoryMock();

    await getAllReviewJobs({
      page: 1,
      limit: 10,
      user: { userId: "admin-1", isAdmin: true },
      deps: { repo },
    });

    expect(repo.findAllReviewJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleTo: { userId: "admin-1", isAdmin: true },
      })
    );
  });
});
