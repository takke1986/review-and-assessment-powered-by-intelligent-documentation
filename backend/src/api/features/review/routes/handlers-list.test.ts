import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAllReviewJobsHandler } from "./handlers";
import { getAllReviewJobs } from "../usecase/review-job";

vi.mock("../usecase/review-job", () => ({
  getAllReviewJobs: vi.fn(),
}));

describe("getAllReviewJobsHandler", () => {
  const makeReply = () => ({
    code: vi.fn().mockReturnThis(),
    send: vi.fn(),
  });

  const call = async (query: Record<string, unknown>) => {
    const reply = makeReply();
    await getAllReviewJobsHandler(
      { query, user: { userId: "u-1", isAdmin: false } } as any,
      reply as any
    );
    return vi.mocked(getAllReviewJobs).mock.calls.at(-1)?.[0];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllReviewJobs).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    } as any);
  });

  it("allows sorting by cost", async () => {
    const params = await call({ sortBy: "totalCost", sortOrder: "desc" });

    expect(params?.sortBy).toBe("totalCost");
  });

  it("falls back to id for a column that cannot be sorted", async () => {
    const params = await call({ sortBy: "stats" });

    expect(params?.sortBy).toBe("id");
  });
});
