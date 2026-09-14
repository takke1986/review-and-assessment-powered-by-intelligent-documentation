import { describe, it, expect, vi } from "vitest";
import { loadRerunSource } from "./review-job";
import { ValidationError } from "../../../core/errors/application-errors";
import {
  REVIEW_JOB_STATUS,
  type ReviewJobDetail,
} from "../domain/model/review";
import type {
  ReviewJobRepository,
  ReviewResultRepository,
} from "../domain/repository";

const sourceJob = (overrides: Partial<ReviewJobDetail> = {}) =>
  ({
    id: "source-job",
    name: "original",
    status: REVIEW_JOB_STATUS.COMPLETED,
    hasError: false,
    userId: "user-1",
    checkList: {
      id: "set-1",
      name: "checklist",
      description: "",
      documents: [],
    },
    documents: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as unknown as ReviewJobDetail;

const deps = (job: ReviewJobDetail) => {
  const reviewJobRepo = {
    findReviewJobById: vi.fn().mockResolvedValue(job),
  } as unknown as ReviewJobRepository;
  const reviewResultRepo = {
    findReviewResultsById: vi.fn().mockResolvedValue([{ id: "prev-A" }]),
  } as unknown as ReviewResultRepository;
  return { reviewJobRepo, reviewResultRepo };
};

const owner = { userId: "user-1", isAdmin: false };

describe("loadRerunSource", () => {
  it("returns the results of a completed job owned by the user", async () => {
    const d = deps(sourceJob());

    const source = await loadRerunSource({
      sourceReviewJobId: "source-job",
      checkListSetId: "set-1",
      user: owner,
      deps: d,
    });

    expect(source).toEqual({
      reviewJobId: "source-job",
      results: [{ id: "prev-A" }],
      documents: [],
    });
    expect(d.reviewResultRepo.findReviewResultsById).toHaveBeenCalledWith({
      jobId: "source-job",
      includeAllChildren: true,
    });
  });

  it("refuses another user's job", async () => {
    const d = deps(sourceJob());

    await expect(
      loadRerunSource({
        sourceReviewJobId: "source-job",
        checkListSetId: "set-1",
        user: { userId: "someone-else", isAdmin: false },
        deps: d,
      })
    ).rejects.toThrow();
    expect(d.reviewResultRepo.findReviewResultsById).not.toHaveBeenCalled();
  });

  it("refuses a job that has not finished", async () => {
    await expect(
      loadRerunSource({
        sourceReviewJobId: "source-job",
        checkListSetId: "set-1",
        user: owner,
        deps: deps(sourceJob({ status: REVIEW_JOB_STATUS.PROCESSING })),
      })
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a different checklist set", async () => {
    await expect(
      loadRerunSource({
        sourceReviewJobId: "source-job",
        checkListSetId: "set-2",
        user: owner,
        deps: deps(sourceJob()),
      })
    ).rejects.toThrow(ValidationError);
  });
});
