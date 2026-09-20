import type { TFunction } from "i18next";
import { CHECK_ITEM_IMPORTANCE } from "../../checklist/types";
import {
  REVIEW_RESULT,
  type ReviewJobDocument,
  type ReviewResultDetail,
} from "../types";

/**
 * 審査結果を「人に見せる形」にするための共通部分。
 *
 * CSV・印刷・テキストの3つが同じ並びと同じ番号になるようにする。
 * 別々に組み立てると、同じ審査なのに出力先によって番号が違うことになり、
 * 紙とファイルを突き合わせたときに話が合わなくなる
 */

export const IMPORTANCE_LABEL_KEY: Record<CHECK_ITEM_IMPORTANCE, string> = {
  [CHECK_ITEM_IMPORTANCE.HIGH]: "checklist.importanceHigh",
  [CHECK_ITEM_IMPORTANCE.MEDIUM]: "checklist.importanceMedium",
  [CHECK_ITEM_IMPORTANCE.LOW]: "checklist.importanceLow",
};

export interface ReportRow {
  result: ReviewResultDetail;
  /** 「1.2.3」の通し番号 */
  number: string;
  /** 0 が最上位 */
  depth: number;
}

/**
 * 親から子へ順に並べ、各項目に「1.2.3」のような通し番号を振る。
 *
 * API は階層を平らにして返すので、そのまま並べると親子の関係が分からない。
 * 紙にも表計算ソフトにも入れ子が無いため、番号と深さで表す
 */
export function flattenInOrder(results: ReviewResultDetail[]): ReportRow[] {
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

  const rows: ReportRow[] = [];
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

/** 参照元を「ファイル名 p.3」の形にする。画像にはページが無い */
export function formatSources(
  result: ReviewResultDetail,
  filenameById: Map<string, string>,
  t: TFunction
): string[] {
  if (!result.sourceReferences?.length) {
    return [];
  }
  return result.sourceReferences.map((reference) => {
    const filename =
      filenameById.get(reference.documentId) ?? reference.documentId;
    return reference.pageNumber
      ? `${filename} ${t("review.export.page", { page: reference.pageNumber })}`
      : filename;
  });
}

export const filenamesById = (documents: ReviewJobDocument[]) =>
  new Map(documents.map((document) => [document.id, document.filename]));

/** 判定の文言。判定がまだ無い項目は空にする */
export function verdictLabel(
  result: ReviewResultDetail,
  t: TFunction
): string {
  if (result.result === REVIEW_RESULT.PASS) return t("review.pass");
  if (result.result === REVIEW_RESULT.FAIL) return t("review.fail");
  return "";
}

/** 合否の件数。表紙に出して、開かなくても内容が分かるようにする */
export function countVerdicts(results: ReviewResultDetail[]) {
  const leaves = results.filter((result) => !result.hasChildren);
  return {
    total: leaves.length,
    passed: leaves.filter((r) => r.result === REVIEW_RESULT.PASS).length,
    failed: leaves.filter((r) => r.result === REVIEW_RESULT.FAIL).length,
  };
}

/** ファイル名に使えない文字を落とす。ジョブ名は自由に付けられる */
export function toSafeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}
