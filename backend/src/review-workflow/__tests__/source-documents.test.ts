import { describe, it, expect } from "vitest";
import { selectSourceDocuments } from "../review-postprocessing/source-documents";

const documents = [
  { id: "doc-1", filename: "稟議書.pdf" },
  { id: "doc-2", filename: "見積書.xlsx" },
  { id: "doc-3", filename: "仕様書.pdf" },
];
const documentIds = ["doc-1", "doc-2", "doc-3"];

describe("selectSourceDocuments", () => {
  it("keeps only the files the review relied on, with their pages", () => {
    expect(
      selectSourceDocuments({
        documents,
        documentIds,
        sources: [
          { file: "仕様書.pdf", page: 4 },
          { file: "見積書.xlsx", page: null },
        ],
      })
    ).toEqual([
      { documentId: "doc-3", filename: "仕様書.pdf", pageNumber: 4 },
      { documentId: "doc-2", filename: "見積書.xlsx", pageNumber: undefined },
    ]);
  });

  it("never gives a page to a file that has none", () => {
    expect(
      selectSourceDocuments({
        documents,
        documentIds,
        sources: [{ file: "見積書.xlsx", page: 2 }],
      })
    ).toEqual([
      { documentId: "doc-2", filename: "見積書.xlsx", pageNumber: undefined },
    ]);
  });

  it("matches names regardless of case and surrounding spaces", () => {
    expect(
      selectSourceDocuments({
        documents: [{ id: "doc-1", filename: "Report.PDF" }],
        documentIds: ["doc-1"],
        sources: [{ file: " report.pdf ", page: 1 }],
      })
    ).toEqual([{ documentId: "doc-1", filename: "Report.PDF", pageNumber: 1 }]);
  });

  it("points at every file of that name when two files share it", () => {
    const shared = [
      { id: "doc-1", filename: "report.pdf" },
      { id: "doc-2", filename: "report.pdf" },
    ];
    expect(
      selectSourceDocuments({
        documents: shared,
        documentIds: ["doc-1", "doc-2"],
        sources: [{ file: "report.pdf", page: 2 }],
      }).map((doc) => doc.documentId)
    ).toEqual(["doc-1", "doc-2"]);
  });

  it("falls back to every reviewed file when no source matches", () => {
    expect(
      selectSourceDocuments({
        documents,
        documentIds,
        sources: [{ file: "unknown.pdf", page: 1 }],
        pageNumber: 3,
      })
    ).toEqual([
      { documentId: "doc-1", filename: "稟議書.pdf", pageNumber: 3 },
      { documentId: "doc-2", filename: "見積書.xlsx", pageNumber: undefined },
      { documentId: "doc-3", filename: "仕様書.pdf", pageNumber: 3 },
    ]);
  });

  it("falls back to page 1 for PDFs when the review returns no sources", () => {
    expect(
      selectSourceDocuments({
        documents,
        documentIds: ["doc-1"],
        sources: undefined,
      })
    ).toEqual([{ documentId: "doc-1", filename: "稟議書.pdf", pageNumber: 1 }]);
  });

  it("ignores malformed sources", () => {
    expect(
      selectSourceDocuments({
        documents,
        documentIds: ["doc-1"],
        sources: ["稟議書.pdf", { page: 2 }, { file: "稟議書.pdf", page: 1.5 }],
      })
    ).toEqual([
      { documentId: "doc-1", filename: "稟議書.pdf", pageNumber: undefined },
    ]);
  });
});
