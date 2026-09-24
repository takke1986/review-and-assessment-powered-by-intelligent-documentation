/**
 * 文書の取り出しと削除。キーやバケットは画面から送られてくるので、
 * 見てよい審査の文書と、使われていないアップロードにだけ効くこと
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../core/s3", () => ({
  getDownloadPresignedUrl: vi.fn(
    async (bucket: string, key: string, expiresIn: number) =>
      `https://signed/${bucket}/${key}?e=${expiresIn}`
  ),
  deleteS3Object: vi.fn(),
  listS3Keys: vi.fn(),
}));

import { getDocumentDownloadUrl, deleteUnattachedUpload } from "./document";
import type { DocumentAccessRepository } from "../domain/document-access";
import type { RequestUser } from "../../../core/middleware/authorization";

const user = (userId: string, departments?: string) =>
  ({
    userId,
    isAdmin: false,
    ...(departments
      ? { rawClaims: { "custom:departments": departments } }
      : {}),
  }) as unknown as RequestUser;

const repo = (over: Partial<DocumentAccessRepository> = {}) =>
  ({
    findReviewJobsByDocumentKey: vi.fn().mockResolvedValue([]),
    findReviewJob: vi.fn().mockResolvedValue(null),
    findExternalSources: vi.fn().mockResolvedValue([]),
    isDocumentRegistered: vi.fn().mockResolvedValue(false),
    ...over,
  }) as DocumentAccessRepository;

const salesJob = { id: "job-1", userId: "creator", departmentId: "営業部" };

beforeEach(() => {
  process.env.DOCUMENT_BUCKET = "docs";
});

describe("getDocumentDownloadUrl", () => {
  const key = "review/original/01J/spec.pdf";

  it("signs a document of a review the user can see, including the same department", async () => {
    const r = repo({
      findReviewJobsByDocumentKey: vi.fn().mockResolvedValue([salesJob]),
    });
    await expect(
      getDocumentDownloadUrl({
        key,
        user: user("colleague", "営業部"),
        deps: { repo: r },
      })
    ).resolves.toContain("https://signed/docs/");
  });

  it("refuses a document of another department's review", async () => {
    const r = repo({
      findReviewJobsByDocumentKey: vi.fn().mockResolvedValue([salesJob]),
    });
    await expect(
      getDocumentDownloadUrl({
        key,
        user: user("legal", "法務部"),
        deps: { repo: r },
      })
    ).rejects.toThrow("forbidden");
  });

  it("does not sign a key that is not a review document", async () => {
    await expect(
      getDocumentDownloadUrl({
        key: "checklist/processed/x.json",
        user: user("creator"),
        deps: { repo: repo() },
      })
    ).rejects.toThrow("not found");
  });

  it("refuses another bucket unless a review is named", async () => {
    // 以前はアカウント内のどのバケットのどのファイルでも署名できた
    await expect(
      getDocumentDownloadUrl({
        key: "secret.csv",
        bucket: "billing-reports",
        user: user("creator"),
        deps: { repo: repo() },
      })
    ).rejects.toThrow("forbidden");
  });

  it("signs a knowledge base source cited in a review the user can see", async () => {
    const r = repo({
      findReviewJob: vi.fn().mockResolvedValue(salesJob),
      findExternalSources: vi.fn().mockResolvedValue([
        [
          {
            toolName: "retrieve",
            // ツールの出力は JSON の文字列のまま入っている
            output: JSON.stringify({
              results: [
                {
                  locationType: "S3",
                  location: "s3://kb-bucket/manuals/a.pdf",
                },
              ],
            }),
          },
        ],
      ]),
    });
    await expect(
      getDocumentDownloadUrl({
        key: "manuals/a.pdf",
        bucket: "kb-bucket",
        reviewJobId: "job-1",
        user: user("creator"),
        deps: { repo: r },
      })
    ).resolves.toContain("https://signed/kb-bucket/manuals/a.pdf");
  });

  it("refuses a file in the knowledge base bucket that the review did not cite", async () => {
    const r = repo({
      findReviewJob: vi.fn().mockResolvedValue(salesJob),
      findExternalSources: vi
        .fn()
        .mockResolvedValue([
          { results: [{ location: "s3://kb-bucket/manuals/a.pdf" }] },
        ]),
    });
    await expect(
      getDocumentDownloadUrl({
        key: "manuals/other.pdf",
        bucket: "kb-bucket",
        reviewJobId: "job-1",
        user: user("creator"),
        deps: { repo: r },
      })
    ).rejects.toThrow("forbidden");
  });

  it("refuses a knowledge base source of a review the user cannot see", async () => {
    const r = repo({
      findReviewJob: vi.fn().mockResolvedValue(salesJob),
      findExternalSources: vi
        .fn()
        .mockResolvedValue([
          { results: [{ location: "s3://kb-bucket/manuals/a.pdf" }] },
        ]),
    });
    await expect(
      getDocumentDownloadUrl({
        key: "manuals/a.pdf",
        bucket: "kb-bucket",
        reviewJobId: "job-1",
        user: user("legal", "法務部"),
        deps: { repo: r },
      })
    ).rejects.toThrow("forbidden");
  });

  it("caps how long the URL lasts", async () => {
    const r = repo({
      findReviewJobsByDocumentKey: vi.fn().mockResolvedValue([salesJob]),
    });
    await expect(
      getDocumentDownloadUrl({
        key,
        expiresIn: 604800,
        user: user("creator"),
        deps: { repo: r },
      })
    ).resolves.toContain("?e=3600");
  });
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
