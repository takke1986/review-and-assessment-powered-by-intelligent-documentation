import { describe, it, expect } from "vitest";
import { canResume } from "./review-resume";
import { REVIEW_JOB_STATUS } from "../model/review";

describe("canResume", () => {
  it("carries on with a review the user cancelled", () => {
    expect(canResume(REVIEW_JOB_STATUS.CANCELLED)).toBe(true);
  });

  it("carries on with a review that failed part way", () => {
    expect(canResume(REVIEW_JOB_STATUS.FAILED)).toBe(true);
  });

  // 完了した審査に埋める項目はない。文書を直して見てもらうのは再審査で、
  // そちらは元の結果を残したまま新しいジョブを作る
  it("leaves a finished review alone", () => {
    expect(canResume(REVIEW_JOB_STATUS.COMPLETED)).toBe(false);
  });

  // 走っているものを待ちに戻すと、同じ項目を2回審査してしまう
  it("leaves a running review alone", () => {
    expect(canResume(REVIEW_JOB_STATUS.PROCESSING)).toBe(false);
    expect(canResume(REVIEW_JOB_STATUS.PENDING)).toBe(false);
  });
});
