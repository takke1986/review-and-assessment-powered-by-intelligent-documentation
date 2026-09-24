import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("../../../core/sqs", () => ({
  sendMessage,
  getQueueDepth: vi.fn(),
}));

vi.mock("../../../core/s3", () => ({
  getPresignedUrl: vi.fn(),
  getS3ObjectSize: vi.fn().mockResolvedValue(1024),
}));

import { createReviewJob } from "./review-job";
import { getS3ObjectSize } from "../../../core/s3";
import { REVIEW_FILE_TYPE, REVIEW_JOB_STATUS } from "../domain/model/review";
import type { ReviewJobRepository } from "../domain/repository";
import type { CheckRepository } from "../../checklist/domain/repository";
import type { RequestUser } from "../../../core/middleware/authorization";

const requestBody = {
  name: "job",
  checkListSetId: "set-1",
  documents: [
    {
      id: "doc-1",
      filename: "spec.pdf",
      s3Key: "review/original/doc-1/spec.pdf",
      fileType: REVIEW_FILE_TYPE.PDF,
    },
  ],
  userId: "user-1",
};

const user = { userId: "user-1", isAdmin: false } as RequestUser;

const deps = () => ({
  checkRepo: {
    findCheckListSetAccess: vi
      .fn()
      .mockResolvedValue({ id: "set-1", userId: "user-1" }),
    findCheckListItems: vi
      .fn()
      .mockResolvedValue([
        { id: "A", setId: "set-1", name: "A", hasChildren: false },
      ]),
  } as unknown as CheckRepository,
  reviewJobRepo: {
    createReviewJob: vi.fn().mockResolvedValue(undefined),
    updateJobStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReviewJobRepository,
});

describe("createReviewJob", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    process.env.DOCUMENT_BUCKET = "bucket";
    process.env.REVIEW_QUEUE_URL = "https://sqs.example/queue";
  });

  it("saves the job before queueing it", async () => {
    // The review workflow starts as soon as the message arrives and updates
    // the job, so the job has to exist by then.
    sendMessage.mockResolvedValue(undefined);
    const d = deps();

    await createReviewJob({ requestBody, user, deps: d });

    const saved = vi.mocked(d.reviewJobRepo.createReviewJob);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(saved.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]
    );
    const jobId = saved.mock.calls[0][0].id;
    expect(sendMessage).toHaveBeenCalledWith(
      "https://sqs.example/queue",
      { reviewJobId: jobId, userId: "user-1" },
      jobId
    );
  });

  it("marks the job as failed when it cannot be queued", async () => {
    sendMessage.mockRejectedValue(new Error("SQS unavailable"));
    const d = deps();

    await expect(
      createReviewJob({ requestBody, user, deps: d })
    ).rejects.toThrow("SQS unavailable");

    const jobId = vi.mocked(d.reviewJobRepo.createReviewJob).mock.calls[0][0]
      .id;
    expect(d.reviewJobRepo.updateJobStatus).toHaveBeenCalledWith({
      reviewJobId: jobId,
      status: REVIEW_JOB_STATUS.FAILED,
      errorDetail: "Failed to queue the review job",
    });
  });

  it("still reports the queueing error if marking the job fails too", async () => {
    sendMessage.mockRejectedValue(new Error("SQS unavailable"));
    const d = deps();
    vi.mocked(d.reviewJobRepo.updateJobStatus).mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(
      createReviewJob({ requestBody, user, deps: d })
    ).rejects.toThrow("SQS unavailable");
  });

  it("does not queue a job that could not be saved", async () => {
    const d = deps();
    vi.mocked(d.reviewJobRepo.createReviewJob).mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(
      createReviewJob({ requestBody, user, deps: d })
    ).rejects.toThrow("database unavailable");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  describe("file size", () => {
    const tenMegabytes = 10 * 1024 * 1024;
    const withDocument = (filename: string) => ({
      ...requestBody,
      documents: [
        {
          id: "doc-1",
          filename,
          s3Key: `review/original/doc-1/${filename}`,
          fileType: REVIEW_FILE_TYPE.PDF,
        },
      ],
    });

    it("refuses a PDF over the PDF limit", async () => {
      vi.mocked(getS3ObjectSize).mockResolvedValueOnce(101 * 1024 * 1024);
      const d = deps();

      await expect(
        createReviewJob({
          requestBody: withDocument("spec.pdf"),
          user,
          deps: d,
        })
      ).rejects.toThrow();
      expect(d.reviewJobRepo.createReviewJob).not.toHaveBeenCalled();
    });

    it("accepts a PDF over the Bedrock document limit, since it is read through tools", async () => {
      vi.mocked(getS3ObjectSize).mockResolvedValueOnce(tenMegabytes);
      sendMessage.mockResolvedValue(undefined);
      const d = deps();

      await createReviewJob({
        requestBody: withDocument("spec.pdf"),
        user,
        deps: d,
      });

      expect(d.reviewJobRepo.createReviewJob).toHaveBeenCalledTimes(1);
    });

    it("refuses an image over the image limit", async () => {
      vi.mocked(getS3ObjectSize).mockResolvedValueOnce(21 * 1024 * 1024);
      const d = deps();

      await expect(
        createReviewJob({
          requestBody: withDocument("photo.jpg"),
          user,
          deps: d,
        })
      ).rejects.toThrow();
      expect(d.reviewJobRepo.createReviewJob).not.toHaveBeenCalled();
    });

    it("accepts a larger Office file, since it is converted before review", async () => {
      vi.mocked(getS3ObjectSize).mockResolvedValueOnce(tenMegabytes);
      sendMessage.mockResolvedValue(undefined);
      const d = deps();

      await createReviewJob({
        requestBody: withDocument("見積書.xlsx"),
        user,
        deps: d,
      });

      expect(d.reviewJobRepo.createReviewJob).toHaveBeenCalledTimes(1);
    });
  });

  describe("checklist access", () => {
    const setOf = (d: ReturnType<typeof deps>, set: object) =>
      vi
        .mocked(d.checkRepo.findCheckListSetAccess)
        .mockResolvedValue(set as never);

    it("refuses a checklist from another department", async () => {
      const d = deps();
      setOf(d, { id: "set-1", userId: "someone", departmentId: "法務部" });
      const sales = {
        userId: "user-1",
        isAdmin: false,
        rawClaims: { "custom:departments": "営業部" },
      } as unknown as RequestUser;

      await expect(
        createReviewJob({ requestBody, user: sales, deps: d })
      ).rejects.toThrow("forbidden");
      expect(d.reviewJobRepo.createReviewJob).not.toHaveBeenCalled();
    });

    it("accepts a checklist from the same department", async () => {
      sendMessage.mockResolvedValue(undefined);
      const d = deps();
      setOf(d, { id: "set-1", userId: "someone", departmentId: "営業部" });
      const sales = {
        userId: "user-1",
        isAdmin: false,
        rawClaims: { "custom:departments": "営業部" },
      } as unknown as RequestUser;

      await createReviewJob({ requestBody, user: sales, deps: d });
      expect(d.reviewJobRepo.createReviewJob).toHaveBeenCalledTimes(1);
    });
  });
});
