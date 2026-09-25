/**
 * 審査ジョブを消すと、S3 のファイルも消える。ファイルを消せなくても、
 * 審査の削除そのものは成功させる（DB の行は先に消えている）
 */
import { describe, it, expect, vi } from "vitest";
import { removeReviewJob } from "./review-job";
import type { ReviewJobRepository } from "../domain/repository";

const job = {
  id: "JOB1",
  userId: "u-1",
  documents: [{ id: "DOC1", s3Path: "review/original/DOC1/申込書.pdf" }],
};
const repo = () =>
  ({
    findReviewJobById: vi.fn().mockResolvedValue(job),
    deleteReviewJobById: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ReviewJobRepository;
const user = { userId: "u-1", isAdmin: false };

describe("removeReviewJob", () => {
  it("deletes the job's files after its rows", async () => {
    process.env.DOCUMENT_BUCKET = "docs";
    const r = repo();
    const deleteObject = vi.fn();
    await removeReviewJob({
      reviewJobId: "JOB1",
      user,
      deps: {
        repo: r,
        files: {
          repo: {
            findReferencedReviewKeys: vi.fn().mockResolvedValue(new Set()),
          } as never,
          listKeys: vi.fn().mockResolvedValue([]),
          deleteObject,
        },
      },
    });
    expect(r.deleteReviewJobById).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(
      "docs",
      "review/original/DOC1/申込書.pdf"
    );
  });

  it("still succeeds when the files cannot be deleted", async () => {
    process.env.DOCUMENT_BUCKET = "docs";
    const r = repo();
    await expect(
      removeReviewJob({
        reviewJobId: "JOB1",
        user,
        deps: {
          repo: r,
          files: {
            repo: {
              findReferencedReviewKeys: vi
                .fn()
                .mockRejectedValue(new Error("S3 down")),
            } as never,
            listKeys: vi.fn(),
            deleteObject: vi.fn(),
          },
        },
      })
    ).resolves.toBeUndefined();
    expect(r.deleteReviewJobById).toHaveBeenCalledTimes(1);
  });
});
