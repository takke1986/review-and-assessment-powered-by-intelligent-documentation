import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resumeReviewJob } from "./review-job";
import { ValidationError } from "../../../core/errors/application-errors";
import {
  REVIEW_JOB_STATUS,
  type ReviewJobDetail,
} from "../domain/model/review";
import type { ReviewJobRepository } from "../domain/repository";
import * as sqs from "../../../core/sqs";

const job = (status: REVIEW_JOB_STATUS, userId = "user-1") =>
  ({
    id: "job-1",
    name: "review",
    status,
    userId,
    documents: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as ReviewJobDetail;

const repoFor = (detail: ReviewJobDetail, reopened = true) =>
  ({
    findReviewJobById: vi.fn().mockResolvedValue(detail),
    reopenJob: vi.fn().mockResolvedValue(reopened),
    updateJobStatus: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ReviewJobRepository;

const owner = { userId: "user-1", isAdmin: false };

let sendMessage: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.REVIEW_QUEUE_URL = "https://example.com/queue.fifo";
  sendMessage = vi.spyOn(sqs, "sendMessage").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resumeReviewJob", () => {
  it("puts a cancelled job back in the queue", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.CANCELLED));

    await resumeReviewJob({
      reviewJobId: "job-1",
      user: owner,
      deps: { repo },
    });

    expect(repo.reopenJob).toHaveBeenCalledWith({ reviewJobId: "job-1" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("puts a failed job back in the queue", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.FAILED));

    await resumeReviewJob({
      reviewJobId: "job-1",
      user: owner,
      deps: { repo },
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  // このキューは本文が同じメッセージを重複と見なして捨てる。識別子を
  // 変えずに送ると、続きから流したつもりで何も起きない
  it("sends a fresh deduplication id, so the queue does not drop it", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.CANCELLED));

    await resumeReviewJob({ reviewJobId: "job-1", user: owner, deps: { repo } });
    await resumeReviewJob({ reviewJobId: "job-1", user: owner, deps: { repo } });

    const [first, second] = sendMessage.mock.calls;
    expect(first[3]).toBeTruthy();
    expect(second[3]).toBeTruthy();
    expect(first[3]).not.toBe(second[3]);
  });

  it("refuses a job that is still running", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.PROCESSING));

    await expect(
      resumeReviewJob({ reviewJobId: "job-1", user: owner, deps: { repo } })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // 完了した審査に埋める項目はない。文書を直して見てもらうのは再審査で、
  // そちらは元の結果を残したまま新しいジョブを作る
  it("refuses a job that already finished", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.COMPLETED));

    await expect(
      resumeReviewJob({ reviewJobId: "job-1", user: owner, deps: { repo } })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses someone who does not own the job", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.CANCELLED, "someone-else"));

    await expect(
      resumeReviewJob({ reviewJobId: "job-1", user: owner, deps: { repo } })
    ).rejects.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // 二重に押されたとき、2通目を送ると同じ項目を2回審査してしまう
  it("stops when the status changed between reading and writing", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.CANCELLED), false);

    await expect(
      resumeReviewJob({ reviewJobId: "job-1", user: owner, deps: { repo } })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // キューに入らなかったジョブは誰も動かさない。待ちのまま残すと、
  // 利用者には「始まらない審査」に見える
  it("marks the job failed when it cannot be queued", async () => {
    const repo = repoFor(job(REVIEW_JOB_STATUS.CANCELLED));
    sendMessage.mockRejectedValue(new Error("queue is down"));

    await expect(
      resumeReviewJob({ reviewJobId: "job-1", user: owner, deps: { repo } })
    ).rejects.toThrow("queue is down");
    expect(repo.updateJobStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: REVIEW_JOB_STATUS.FAILED })
    );
  });
});
