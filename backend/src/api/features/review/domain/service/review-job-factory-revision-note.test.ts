import { describe, it, expect, vi } from "vitest";
import {
  createInitialReviewJobModel,
  normalizeRevisionNote,
} from "./review-job-factory";
import { ValidationError } from "../../../../core/errors";
import { MAX_REVISION_NOTE_LENGTH } from "../../../../constants";
import type { CheckRepository } from "../../../checklist/domain/repository";
import { REVIEW_FILE_TYPE } from "../model/review";

describe("normalizeRevisionNote", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeRevisionNote("  Corrected section 3\n")).toBe(
      "Corrected section 3"
    );
  });

  it("treats a missing or blank note as no note", () => {
    expect(normalizeRevisionNote(undefined)).toBeUndefined();
    expect(normalizeRevisionNote("   \n ")).toBeUndefined();
  });

  it("accepts a note at the limit and rejects one over it", () => {
    const atLimit = "a".repeat(MAX_REVISION_NOTE_LENGTH);
    expect(normalizeRevisionNote(atLimit)).toBe(atLimit);
    expect(() => normalizeRevisionNote(`${atLimit}a`)).toThrow(ValidationError);
  });
});

describe("createInitialReviewJobModel", () => {
  it("stores the normalized revision note on the job", async () => {
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
        documents: [
          {
            id: "doc-2",
            filename: "spec.pdf",
            s3Key: "review/original/doc-2/spec.pdf",
            fileType: REVIEW_FILE_TYPE.PDF,
          },
        ],
        userId: "user-1",
        revisionNote: " Replaced the quote with the latest version ",
      },
      deps: { checkRepo },
    });

    expect(job.revisionNote).toBe("Replaced the quote with the latest version");
  });
});
