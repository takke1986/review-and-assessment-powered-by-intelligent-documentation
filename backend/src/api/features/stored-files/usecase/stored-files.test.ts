/**
 * 文書バケットのファイルを消す処理。使われていないアップロード、消した審査ジョブの
 * ファイル、消したチェックリストのファイル。ほかの行がまだ指すファイルは残す
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../core/s3", () => ({
  deleteS3Object: vi.fn(),
  listS3Keys: vi.fn(),
}));

import {
  deleteUnattachedUpload,
  deleteReviewJobFiles,
  deleteCheckListFiles,
} from "./stored-files";
import type { FileReferenceRepository } from "../domain/file-references";
import type { RequestUser } from "../../../core/middleware/authorization";

const user = (userId: string) =>
  ({ userId, isAdmin: false }) as unknown as RequestUser;

const repo = (over: Partial<FileReferenceRepository> = {}) =>
  ({
    isDocumentRegistered: vi.fn().mockResolvedValue(false),
    findReferencedReviewKeys: vi.fn().mockResolvedValue(new Set()),
    findReferencedChecklistKeys: vi.fn().mockResolvedValue(new Set()),
    findReviewJobsOfCheckListSet: vi.fn().mockResolvedValue([]),
    ...over,
  }) as FileReferenceRepository;

beforeEach(() => {
  process.env.DOCUMENT_BUCKET = "docs";
});

describe("deleteUnattachedUpload", () => {
  const areas = ["review/original/", "review/images/"];
  const documentId = "01J8ZQ4X5T3M2N6P7R8S9V0W1X";

  it("deletes what was uploaded for a document that is not in use", async () => {
    const listKeys = vi.fn(async (_b: string, prefix: string) =>
      prefix.startsWith("review/original/") ? [`${prefix}spec.pdf`] : []
    );
    const deleteObject = vi.fn();
    await deleteUnattachedUpload({
      documentId,
      uploadAreas: areas,
      user: user("creator"),
      deps: { repo: repo(), listKeys, deleteObject },
    });
    expect(listKeys).toHaveBeenCalledWith(
      "docs",
      `review/original/${documentId}/`
    );
    expect(deleteObject).toHaveBeenCalledWith(
      "docs",
      `review/original/${documentId}/spec.pdf`
    );
  });

  it("does not delete a document a review or checklist uses", async () => {
    const deleteObject = vi.fn();
    await expect(
      deleteUnattachedUpload({
        documentId,
        uploadAreas: areas,
        user: user("someone"),
        deps: {
          repo: repo({ isDocumentRegistered: vi.fn().mockResolvedValue(true) }),
          listKeys: vi.fn(),
          deleteObject,
        },
      })
    ).rejects.toThrow("forbidden");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("refuses anything that is not a document id", async () => {
    // 以前は送られた文字列をキーとしてそのまま消していた
    for (const bad of ["review/original/01J/spec.pdf", "../checklist", ""]) {
      await expect(
        deleteUnattachedUpload({
          documentId: bad,
          uploadAreas: areas,
          user: user("someone"),
          deps: { repo: repo(), listKeys: vi.fn(), deleteObject: vi.fn() },
        })
      ).rejects.toThrow("forbidden");
    }
  });
});

describe("deleteReviewJobFiles", () => {
  const own = "review/original/DOC1/申込書.pdf";
  const shared = "review/original/DOC2/契約書.pdf";

  it("deletes files no other review uses, their partial reads, and the job's read-ahead", async () => {
    const deleteObject = vi.fn();
    const listKeys = vi.fn(async (_b: string, prefix: string) => {
      if (prefix === `digest/partials/${own}/`) return [`${prefix}a.json`];
      if (prefix === "digest/JOB1/") return [`digest/JOB1/${own}.json`];
      return [];
    });
    const result = await deleteReviewJobFiles({
      reviewJobId: "JOB1",
      documentKeys: [own, shared],
      deps: {
        // 再審査が同じ契約書を引き継いでいる
        repo: repo({
          findReferencedReviewKeys: vi
            .fn()
            .mockResolvedValue(new Set([shared])),
        }),
        listKeys,
        deleteObject,
      },
    });

    expect(deleteObject.mock.calls.map((c) => c[1])).toEqual([
      own,
      `digest/partials/${own}/a.json`,
      `digest/JOB1/${own}.json`,
    ]);
    expect(result.keptInUse).toEqual([shared]);
  });
});

describe("deleteCheckListFiles", () => {
  it("deletes originals no copy uses and everything derived from each document", async () => {
    const deleteObject = vi.fn();
    const listKeys = vi.fn(async (_b: string, prefix: string) =>
      prefix === "checklist/pages/CD1/" ? [`${prefix}page_1.png`] : []
    );
    const result = await deleteCheckListFiles({
      documents: [
        { id: "CD1", s3Key: "checklist/original/CD1/規程.pdf" },
        // 複製先がまだ同じファイルを指している
        { id: "CD2", s3Key: "checklist/original/CD0/共有.pdf" },
      ],
      deps: {
        repo: repo({
          findReferencedChecklistKeys: vi
            .fn()
            .mockResolvedValue(new Set(["checklist/original/CD0/共有.pdf"])),
        }),
        listKeys,
        deleteObject,
      },
    });
    expect(deleteObject.mock.calls.map((c) => c[1])).toEqual([
      "checklist/original/CD1/規程.pdf",
      "checklist/pages/CD1/page_1.png",
    ]);
    expect(result.keptInUse).toEqual(["checklist/original/CD0/共有.pdf"]);
    // 派生ファイルの置き場は4つとも見る
    expect(
      listKeys.mock.calls.filter((c) => String(c[1]).endsWith("/CD1/"))
    ).toHaveLength(4);
  });
});
