import { describe, it, expect } from "vitest";
import {
  parseListQuery,
  resolvePaging,
  toPaginatedResponse,
} from "./pagination";

const SORTABLE = ["name", "createdAt", "updatedAt"] as const;

describe("parseListQuery", () => {
  it("クエリの文字列を数値にそろえる", () => {
    expect(
      parseListQuery({ page: "3", limit: "50" }, SORTABLE, "createdAt")
    ).toMatchObject({
      page: 3,
      limit: 50,
    });
  });

  it("指定がなければ1ページ目を10件", () => {
    expect(parseListQuery({}, SORTABLE, "createdAt")).toMatchObject({
      page: 1,
      limit: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("許していない列で並べようとしたら既定の列にする", () => {
    expect(
      parseListQuery({ sortBy: "password" }, SORTABLE, "updatedAt").sortBy
    ).toBe("updatedAt");
  });

  it("数値にならない指定は既定値にする。以前は Prisma まで NaN が渡っていた", () => {
    expect(
      parseListQuery({ page: "abc", limit: "" }, SORTABLE, "name")
    ).toMatchObject({
      page: 1,
      limit: 10,
    });
  });

  it("向きは昇順だけ受け、それ以外は降順にする", () => {
    expect(
      parseListQuery({ sortOrder: "asc" }, SORTABLE, "name").sortOrder
    ).toBe("asc");
    expect(
      parseListQuery({ sortOrder: "bogus" }, SORTABLE, "name").sortOrder
    ).toBe("desc");
  });

  it("検索語はそのまま渡す。正規化は検索する側で行う", () => {
    expect(parseListQuery({ search: " 見積 " }, SORTABLE, "name").search).toBe(
      " 見積 "
    );
  });
});

describe("resolvePaging", () => {
  it("skip と take を出す", () => {
    expect(resolvePaging({ page: 3, limit: 20 }, "createdAt")).toMatchObject({
      skip: 40,
      take: 20,
    });
  });

  it("1ページ目の skip は0", () => {
    expect(resolvePaging({}, "createdAt").skip).toBe(0);
  });
});

describe("toPaginatedResponse", () => {
  it("総ページ数を切り上げる", () => {
    expect(toPaginatedResponse(["a"], 21, { page: 1, limit: 10 })).toEqual({
      items: ["a"],
      total: 21,
      page: 1,
      limit: 10,
      totalPages: 3,
    });
  });

  it("1件も無ければ0ページ", () => {
    expect(toPaginatedResponse([], 0, { page: 1, limit: 10 }).totalPages).toBe(
      0
    );
  });
});
