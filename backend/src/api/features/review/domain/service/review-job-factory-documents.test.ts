import { describe, it, expect, vi } from "vitest";
import { createInitialReviewJobModel } from "./review-job-factory";
import { buildRerunDocuments } from "./review-rerun";
import { ValidationError } from "../../../../core/errors";
import type { CheckRepository } from "../../../checklist/domain/repository";
import { REVIEW_FILE_TYPE, ReviewJobDocument } from "../model/review";

const uploadedAt = new Date("2026-09-01T00:00:00Z");

// The source job reviewed an approval request together with a quote.
const sourceDocuments: ReviewJobDocument[] = [
  {
    id: "approval",
    filename: "approval.pdf",
    s3Path: "review/original/approval/approval.pdf",
    fileType: REVIEW_FILE_TYPE.PDF,
    uploadDate: uploadedAt,
  },
  {
    id: "quote",
    filename: "quote.pdf",
    s3Path: "review/original/quote/quote.pdf",
    fileType: REVIEW_FILE_TYPE.PDF,
    uploadDate: uploadedAt,
  },
];

const revisedApproval = {
  id: "approval-v2",
  filename: "approval.pdf",
  s3Key: "review/original/approval-v2/approval.pdf",
  fileType: REVIEW_FILE_TYPE.PDF,
  replacesDocumentId: "approval",
};

describe("buildRerunDocuments", () => {
  it("keeps the unchanged document and adds the replacement", () => {
    const documents = buildRerunDocuments(
      { documents: [revisedApproval], keptDocumentIds: ["quote"] },
      sourceDocuments
    );

    expect(documents).toHaveLength(2);
    const [kept, replacement] = documents;
    expect(kept).toMatchObject({
      filename: "quote.pdf",
      s3Key: "review/original/quote/quote.pdf",
      fileType: REVIEW_FILE_TYPE.PDF,
      uploadDate: uploadedAt,
      carriedFromDocumentId: "quote",
    });
    // A new document row that points at the same file.
    expect(kept.id).not.toBe("quote");
    expect(replacement).toEqual(revisedApproval);
  });

  it("allows a re-review with only kept documents", () => {
    const documents = buildRerunDocuments(
      { documents: [], keptDocumentIds: ["approval", "quote"] },
      sourceDocuments
    );

    expect(documents.map((doc) => doc.carriedFromDocumentId)).toEqual([
      "approval",
      "quote",
    ]);
  });

  it("leaves out source documents that are neither kept nor replaced", () => {
    const documents = buildRerunDocuments(
      { documents: [revisedApproval], keptDocumentIds: [] },
      sourceDocuments
    );

    expect(documents).toEqual([revisedApproval]);
  });

  it("rejects documents that are not in the source job", () => {
    expect(() =>
      buildRerunDocuments(
        { documents: [], keptDocumentIds: ["other-job-document"] },
        sourceDocuments
      )
    ).toThrow(ValidationError);
    expect(() =>
      buildRerunDocuments(
        {
          documents: [{ ...revisedApproval, replacesDocumentId: "missing" }],
          keptDocumentIds: [],
        },
        sourceDocuments
      )
    ).toThrow(ValidationError);
  });

  it("rejects a document that is both kept and replaced", () => {
    expect(() =>
      buildRerunDocuments(
        { documents: [revisedApproval], keptDocumentIds: ["approval"] },
        sourceDocuments
      )
    ).toThrow(ValidationError);
  });

  it("rejects keeping or replacing the same document twice", () => {
    expect(() =>
      buildRerunDocuments(
        { documents: [], keptDocumentIds: ["quote", "quote"] },
        sourceDocuments
      )
    ).toThrow(ValidationError);
    expect(() =>
      buildRerunDocuments(
        {
          documents: [
            revisedApproval,
            { ...revisedApproval, id: "approval-v3" },
          ],
          keptDocumentIds: [],
        },
        sourceDocuments
      )
    ).toThrow(ValidationError);
  });
});

describe("createInitialReviewJobModel without a source job", () => {
  const checkRepo = {
    findCheckListItems: vi
      .fn()
      .mockResolvedValue([
        { id: "A", setId: "set-1", name: "A", hasChildren: false },
      ]),
  } as unknown as CheckRepository;
  const base = {
    name: "job",
    checkListSetId: "set-1",
    userId: "user-1",
  };

  it("rejects kept documents", async () => {
    await expect(
      createInitialReviewJobModel({
        req: { ...base, documents: [], keptDocumentIds: ["quote"] },
        deps: { checkRepo },
      })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a replacement", async () => {
    await expect(
      createInitialReviewJobModel({
        req: { ...base, documents: [revisedApproval] },
        deps: { checkRepo },
      })
    ).rejects.toThrow(ValidationError);
  });
});

describe("createInitialReviewJobModel with a source job", () => {
  it("builds the documents from the source job", async () => {
    const checkRepo = {
      findCheckListItems: vi
        .fn()
        .mockResolvedValue([
          { id: "A", setId: "set-1", name: "A", hasChildren: false },
        ]),
    } as unknown as CheckRepository;

    const job = await createInitialReviewJobModel({
      req: {
        name: "revised",
        checkListSetId: "set-1",
        userId: "user-1",
        sourceReviewJobId: "source-job",
        checkIds: ["A"],
        documents: [revisedApproval],
        keptDocumentIds: ["quote"],
      },
      deps: { checkRepo },
      source: {
        reviewJobId: "source-job",
        results: [],
        documents: sourceDocuments,
      },
    });

    expect(
      job.documents.map((doc) => [
        doc.filename,
        doc.carriedFromDocumentId,
        doc.replacesDocumentId,
      ])
    ).toEqual([
      ["quote.pdf", "quote", undefined],
      ["approval.pdf", undefined, "approval"],
    ]);
  });
});
