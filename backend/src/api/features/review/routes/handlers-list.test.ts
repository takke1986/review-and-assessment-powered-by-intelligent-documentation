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
      costSummary: { totalCost: 0, jobCount: 0 },
    } as any);
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

    expect(params?.createdFrom).toBeUndefined();
    expect(params?.createdTo).toBeUndefined();
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
