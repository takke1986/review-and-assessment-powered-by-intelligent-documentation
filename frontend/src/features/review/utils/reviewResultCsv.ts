import type { TFunction } from "i18next";
import { type ReviewJobDocument, type ReviewResultDetail } from "../types";
import {
  filenamesById,
  flattenInOrder,
  formatSources,
  IMPORTANCE_LABEL_KEY,
  overriddenByLabel,
  verdictLabel,
} from "./reviewReportModel";

export { toSafeFilename } from "./reviewReportModel";

/**
 * Excel は先頭の BOM が無いと UTF-8 と判断せず、日本語が文字化けする。
 * メモ帳や表計算ソフトで開くのが主な使い方なので、必ず付ける
 */
const BOM = "﻿";

/** Excel は行末が CRLF でないと、セル内の改行と行の区切りを取り違える */
const LINE_END = "\r\n";

/**
 * 値を1つのセルにする。
 *
 * 区切り文字・引用符・改行のどれが入っていても壊れないよう、常に引用符で囲む。
 * 説明文には読点も改行も普通に入るので、条件を見て囲むかどうかを決めると取りこぼす
 */
function toCell(value: string | undefined): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
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
  const filenameById = filenamesById(documents);

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
    "overriddenBy",
    "userComment",
  ].map((key) => toCell(t(`review.export.column.${key}`)));

  const rows = flattenInOrder(results).map(({ result, number }) => {
    const importance = result.checkList.importance;
    return [
      toCell(number),
      toCell(result.checkList.name),
      toCell(importance ? t(IMPORTANCE_LABEL_KEY[importance]) : ""),
      toCell(verdictLabel(result, t)),
      // 割合ではなく百分率にする。画面の表示と揃える
      toCell(
        result.confidenceScore === undefined
          ? ""
          : `${Math.round(result.confidenceScore * 100)}%`
      ),
      toCell(result.shortExplanation),
      toCell(result.explanation),
      toCell(result.extractedText?.join("\n")),
      toCell(formatSources(result, filenameById, t).join("\n")),
      toCell(result.userOverride ? t("common.yes") : t("common.no")),
      toCell(overriddenByLabel(result, t)),
      toCell(result.userComment),
    ].join(",");
  });

  return BOM + [headers.join(","), ...rows].join(LINE_END) + LINE_END;
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
