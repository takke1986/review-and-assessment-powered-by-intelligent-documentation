import { describe, it, expect } from "vitest";
import { assertUploadKeyOrThrow } from "./upload-key";

const areas = ["review/original/", "review/images/"];

describe("assertUploadKeyOrThrow", () => {
  it("accepts the place the document was uploaded to", () => {
    expect(() =>
      assertUploadKeyOrThrow(
        { id: "DOC1", s3Key: "review/original/DOC1/spec.pdf" },
        areas
      )
    ).not.toThrow();
    expect(() =>
      assertUploadKeyOrThrow(
        { id: "DOC1", s3Key: "review/images/DOC1/0_a.png" },
        areas
      )
    ).not.toThrow();
  });

  it("refuses a key that belongs to another document", () => {
    // 他人がアップロードした書類のキーを書いて審査にかけられないこと
    expect(() =>
      assertUploadKeyOrThrow(
        { id: "DOC1", s3Key: "review/original/DOC2/spec.pdf" },
        areas
      )
    ).toThrow("Invalid document location");
  });

  it("refuses a key outside the upload area", () => {
    for (const s3Key of [
      "checklist/original/DOC1/a.pdf",
      "DOC1/a.pdf",
      "review/original/DOC1/",
    ]) {
      expect(() =>
        assertUploadKeyOrThrow({ id: "DOC1", s3Key }, areas)
      ).toThrow();
    }
  });
});
