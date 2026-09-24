import { describe, it, expect } from "vitest";
import {
  uploadContentTypeOrThrow,
  downloadResponseHeaders,
  REVIEW_UPLOAD_EXTENSIONS,
  REVIEW_IMAGE_EXTENSIONS,
  CHECKLIST_UPLOAD_EXTENSIONS,
} from "./upload-types";

describe("uploadContentTypeOrThrow", () => {
  it("decides the content type from the extension", () => {
    expect(
      uploadContentTypeOrThrow("見積書.PDF", REVIEW_UPLOAD_EXTENSIONS)
    ).toBe("application/pdf");
    expect(
      uploadContentTypeOrThrow("photo.jpeg", REVIEW_IMAGE_EXTENSIONS)
    ).toBe("image/jpeg");
    expect(
      uploadContentTypeOrThrow("list.csv", CHECKLIST_UPLOAD_EXTENSIONS)
    ).toBe("text/csv");
  });

  it("refuses files a browser would run", () => {
    // S3 のドメインのまま開かれて、スクリプトが動く
    for (const name of ["page.html", "logo.svg", "a.htm", "x.js", "noext"]) {
      expect(() =>
        uploadContentTypeOrThrow(name, REVIEW_UPLOAD_EXTENSIONS)
      ).toThrow("Unsupported file type");
    }
  });

  it("keeps each upload area to its own kinds", () => {
    expect(() =>
      uploadContentTypeOrThrow("a.pdf", REVIEW_IMAGE_EXTENSIONS)
    ).toThrow();
    expect(() =>
      uploadContentTypeOrThrow("a.png", CHECKLIST_UPLOAD_EXTENSIONS)
    ).toThrow();
    expect(() =>
      uploadContentTypeOrThrow("a.csv", REVIEW_UPLOAD_EXTENSIONS)
    ).toThrow();
  });

  it("looks at the last extension only", () => {
    expect(() =>
      uploadContentTypeOrThrow("a.pdf.html", REVIEW_UPLOAD_EXTENSIONS)
    ).toThrow();
  });
});

describe("downloadResponseHeaders", () => {
  it("opens PDF and images in the browser", () => {
    expect(downloadResponseHeaders("review/original/D/見積.pdf")).toEqual({
      contentType: "application/pdf",
      contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent("見積.pdf")}`,
    });
  });

  it("saves everything else instead of opening it", () => {
    // ナレッジベースのバケットには HTML が置かれていることもある
    expect(downloadResponseHeaders("kb/page.html")).toMatchObject({
      contentType: "application/octet-stream",
      contentDisposition: expect.stringMatching(/^attachment;/),
    });
    expect(
      downloadResponseHeaders("review/original/D/a.xlsx").contentDisposition
    ).toMatch(/^attachment;/);
  });
});
