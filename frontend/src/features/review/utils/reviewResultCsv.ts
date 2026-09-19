import type { TFunction } from "i18next";
import { CHECK_ITEM_IMPORTANCE } from "../../checklist/types";
import {
  REVIEW_RESULT,
  type ReviewJobDocument,
  type ReviewResultDetail,
} from "../types";

/**
 * Excel は先頭の BOM が無いと UTF-8 と判断せず、日本語が文字化けする。
 * メモ帳や表計算ソフトで開くのが主な使い方なので、必ず付ける
 */
const BOM = "﻿";

/** Excel は行末が CRLF でないと、セル内の改行と行の区切りを取り違える */
const LINE_END = "\r\n";

const IMPORTANCE_LABEL_KEY: Record<CHECK_ITEM_IMPORTANCE, string> = {
  [CHECK_ITEM_IMPORTANCE.HIGH]: "checklist.importanceHigh",
  [CHECK_ITEM_IMPORTANCE.MEDIUM]: "checklist.importanceMedium",
  [CHECK_ITEM_IMPORTANCE.LOW]: "checklist.importanceLow",
};

/**
 * 値を1つのセルにする。
 *
 * 区切り文字・引用符・改行のどれが入っていても壊れないよう、常に引用符で囲む。
 * 説明文には読点も改行も普通に入るので、条件を見て囲むかどうかを決めると取りこぼす
 */
function toCell(value: string | undefined): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

/** 参照元を「ファイル名 p.3」の形にする。画像にはページが無い */
function formatSources(
  result: ReviewResultDetail,
  filenameById: Map<string, string>,
  t: TFunction
): string {
  if (!result.sourceReferences?.length) {
    return "";
  }
  return result.sourceReferences
    .map((reference) => {
      const filename =
        filenameById.get(reference.documentId) ?? reference.documentId;
      return reference.pageNumber
        ? `${filename} ${t("review.export.page", { page: reference.pageNumber })}`
        : filename;
    })
    .join("\n");
}

/**
 * 親から子へ順に並べ、各項目に「1.2.3」のような通し番号を振る。
 *
 * API は階層を平らにして返すので、そのまま書き出すと親子の関係が分からない。
 * 表計算ソフトには入れ子が無いため、番号と深さで表す
 */
function flattenInOrder(
  results: ReviewResultDetail[]
): Array<{ result: ReviewResultDetail; number: string; depth: number }> {
  const childrenOf = new Map<string, ReviewResultDetail[]>();
  const known = new Set(results.map((result) => result.checkList.id));
  for (const result of results) {
    // 親が結果に含まれていなければ根として扱う（項目を選んで審査した場合）
    const parentId = result.checkList.parentId;
    const key = parentId && known.has(parentId) ? parentId : "";
    const siblings = childrenOf.get(key) ?? [];
    siblings.push(result);
    childrenOf.set(key, siblings);
  }

  const rows: Array<{
    result: ReviewResultDetail;
    number: string;
    depth: number;
  }> = [];
  const walk = (parentKey: string, prefix: string, depth: number) => {
    const children = childrenOf.get(parentKey) ?? [];
    children.forEach((result, index) => {
      const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      rows.push({ result, number, depth });
      walk(result.checkList.id, number, depth + 1);
    });
  };
  walk("", "", 0);
  return rows;
}

/**
 * 審査結果を CSV にする。
 *
 * 書き出すのは画面に出ている内容と同じもの。絞り込みは掛けずに全件出す。
 * 手元で並べ替えたり、不合格だけ抜いたりするのは表計算ソフトの方が早い
 */
export function buildReviewResultCsv(params: {
  jobName: string;
  results: ReviewResultDetail[];
  documents: ReviewJobDocument[];
  t: TFunction;
}): string {
  const { results, documents, t } = params;
  const filenameById = new Map(
    documents.map((document) => [document.id, document.filename])
  );

  const headers = [
    "number",
    "name",
    "importance",
    "result",
    "confidence",
    "shortExplanation",
    "explanation",
    "extractedText",
    "sources",
    "userOverride",
    "userComment",
  ].map((key) => toCell(t(`review.export.column.${key}`)));

  const rows = flattenInOrder(results).map(({ result, number }) => {
    const importance = result.checkList.importance;
    return [
      toCell(number),
      toCell(result.checkList.name),
      toCell(importance ? t(IMPORTANCE_LABEL_KEY[importance]) : ""),
      toCell(
        result.result === REVIEW_RESULT.PASS
          ? t("review.pass")
          : result.result === REVIEW_RESULT.FAIL
            ? t("review.fail")
            : ""
      ),
      // 割合ではなく百分率にする。画面の表示と揃える
      toCell(
        result.confidenceScore === undefined
          ? ""
          : `${Math.round(result.confidenceScore * 100)}%`
      ),
      toCell(result.shortExplanation),
      toCell(result.explanation),
      toCell(result.extractedText?.join("\n")),
      toCell(formatSources(result, filenameById, t)),
      toCell(result.userOverride ? t("common.yes") : t("common.no")),
      toCell(result.userComment),
    ].join(",");
  });

  return BOM + [headers.join(","), ...rows].join(LINE_END) + LINE_END;
}

/** ファイル名に使えない文字を落とす。ジョブ名は自由に付けられる */
export function toSafeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

/** 組み立てた CSV を、その場でファイルとして落とす */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
