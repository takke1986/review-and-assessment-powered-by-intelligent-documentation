import { describe, it, expect } from "vitest";
import { canCancel, shouldKeepCancelled } from "./review-job-cancel";
import { REVIEW_JOB_STATUS } from "../model/review";

describe("canCancel", () => {
  it("待ち行列にいるものは止められる", () => {
    expect(canCancel(REVIEW_JOB_STATUS.PENDING)).toBe(true);
  });

  it("走っているものは止められる", () => {
    expect(canCancel(REVIEW_JOB_STATUS.PROCESSING)).toBe(true);
  });

  it("終わったものは止められない", () => {
    expect(canCancel(REVIEW_JOB_STATUS.COMPLETED)).toBe(false);
    expect(canCancel(REVIEW_JOB_STATUS.FAILED)).toBe(false);
  });

  it("すでに止めたものは、もう一度止められない", () => {
    expect(canCancel(REVIEW_JOB_STATUS.CANCELLED)).toBe(false);
  });
});

describe("shouldKeepCancelled", () => {
  it("中止したものに、あとから届いた処理中を上書きさせない", () => {
    // 止めたはずのものが動いているように見えてしまう
    expect(
      shouldKeepCancelled(
        REVIEW_JOB_STATUS.CANCELLED,
        REVIEW_JOB_STATUS.PROCESSING
      )
    ).toBe(true);
  });

  it("中止したものに、あとから届いた失敗も上書きさせない", () => {
    expect(
      shouldKeepCancelled(REVIEW_JOB_STATUS.CANCELLED, REVIEW_JOB_STATUS.FAILED)
    ).toBe(true);
  });

  it("中止したものに、完了も上書きさせない", () => {
    expect(
      shouldKeepCancelled(
        REVIEW_JOB_STATUS.CANCELLED,
        REVIEW_JOB_STATUS.COMPLETED
      )
    ).toBe(true);
  });

  it("中止していないものは、普通に書き換わる", () => {
    expect(
      shouldKeepCancelled(
        REVIEW_JOB_STATUS.PROCESSING,
        REVIEW_JOB_STATUS.COMPLETED
      )
    ).toBe(false);
  });
});
