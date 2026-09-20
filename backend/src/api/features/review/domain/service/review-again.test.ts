import { describe, it, expect } from "vitest";
import { canReviewAgain, endedEarly } from "./review-again";
import { REVIEW_JOB_STATUS } from "../model/review";

describe("canReviewAgain", () => {
  it("完了したジョブは元にできる", () => {
    expect(canReviewAgain(REVIEW_JOB_STATUS.COMPLETED)).toBe(true);
  });

  it("失敗したジョブも元にできる。途中まで済んだ項目を捨てないため", () => {
    expect(canReviewAgain(REVIEW_JOB_STATUS.FAILED)).toBe(true);
  });

  it("中止したジョブも元にできる。続きから流せる", () => {
    expect(canReviewAgain(REVIEW_JOB_STATUS.CANCELLED)).toBe(true);
  });

  it("まだ走っているものは元にできない。同じ項目を二重に審査してしまう", () => {
    expect(canReviewAgain(REVIEW_JOB_STATUS.PENDING)).toBe(false);
    expect(canReviewAgain(REVIEW_JOB_STATUS.PROCESSING)).toBe(false);
  });
});

describe("endedEarly", () => {
  it("失敗と中止は途中で終わったとみなす", () => {
    expect(endedEarly(REVIEW_JOB_STATUS.FAILED)).toBe(true);
    expect(endedEarly(REVIEW_JOB_STATUS.CANCELLED)).toBe(true);
  });

  it("完了は途中で終わっていない", () => {
    expect(endedEarly(REVIEW_JOB_STATUS.COMPLETED)).toBe(false);
  });
});
