import { describe, it, expect } from "vitest";
import { splitByGuidance, wasOverturned } from "./guidance-effect";

const written = new Date("2026-09-10T00:00:00Z");

const judged = (
  overrides: Partial<Parameters<typeof wasOverturned>[0]> = {}
) => ({
  checkId: "check-1",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  userOverride: false,
  aiResult: "fail",
  result: "fail",
  ...overrides,
});

describe("wasOverturned", () => {
  it("人が覆し、AI と違う結果になっていれば覆されたと見る", () => {
    expect(wasOverturned(judged({ userOverride: true, result: "pass" }))).toBe(
      true
    );
  });

  it("上書きしても結果が同じなら覆していない（コメントを足しただけ）", () => {
    expect(wasOverturned(judged({ userOverride: true, result: "fail" }))).toBe(
      false
    );
  });

  it("AI の判定が分からない古い結果は数えない", () => {
    expect(
      wasOverturned(
        judged({ userOverride: true, aiResult: null, result: "pass" })
      )
    ).toBe(false);
  });
});

describe("splitByGuidance", () => {
  it("着眼点を書いた日を境に前後で分ける", () => {
    const effect = splitByGuidance({
      writtenAt: written,
      results: [
        judged({
          createdAt: new Date("2026-09-01T00:00:00Z"),
          userOverride: true,
          result: "pass",
        }),
        judged({
          createdAt: new Date("2026-09-05T00:00:00Z"),
          userOverride: true,
          result: "pass",
        }),
        judged({ createdAt: new Date("2026-09-08T00:00:00Z") }),
        judged({ createdAt: new Date("2026-09-12T00:00:00Z") }),
        judged({ createdAt: new Date("2026-09-15T00:00:00Z") }),
      ],
    });

    expect(effect.before).toEqual({ reviewed: 3, overturned: 2 });
    expect(effect.after).toEqual({ reviewed: 2, overturned: 0 });
  });

  it("境目は判定を作った日で見る。あとで覆しても、判定自体は着眼点より前", () => {
    const effect = splitByGuidance({
      writtenAt: written,
      results: [
        judged({
          createdAt: new Date("2026-09-09T00:00:00Z"),
          userOverride: true,
          result: "pass",
        }),
      ],
    });

    expect(effect.before.overturned).toBe(1);
    expect(effect.after.reviewed).toBe(0);
  });

  it("書いたあとにまだ審査していなければ、後ろは空になる", () => {
    const effect = splitByGuidance({
      writtenAt: written,
      results: [judged({ createdAt: new Date("2026-09-01T00:00:00Z") })],
    });

    expect(effect.after).toEqual({ reviewed: 0, overturned: 0 });
  });
});
