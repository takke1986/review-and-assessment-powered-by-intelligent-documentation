import type { TFunction } from "i18next";
import { REVIEW_RESULT, type ReviewJobDocument, type ReviewResultDetail } from "../types";
import {
  countVerdicts,
  filenamesById,
  flattenInOrder,
  formatSources,
  verdictLabel,
} from "./reviewReportModel";

/**
 * 審査結果を、そのまま貼れる文章にする。
 *
 * CSV は表なので、文章を書かせる相手に渡すには向かない。これは人が読んでも、
 * 生成AIに「この内容でメール文を作って」と渡しても通る形にする。
 *
 * 不合格の項目は理由と根拠まで書き、合格の項目は名前と判定だけにする。
 * 全項目に同じ厚みで書くと、直すべき点が埋もれる
 */
export function buildReviewResultText(params: {
  jobName: string;
  checkListName: string;
  completedAt?: Date;
  documents: ReviewJobDocument[];
  results: ReviewResultDetail[];
  t: TFunction;
}): string {
  const { jobName, checkListName, completedAt, documents, results, t } = params;
  const filenameById = filenamesById(documents);
  const counts = countVerdicts(results);
  const rows = flattenInOrder(results);

  const lines: string[] = [
    `${t("review.report.title")}: ${jobName}`,
    `${t("review.checklist")}: ${checkListName}`,
  ];
  if (completedAt) {
    lines.push(
      `${t("review.completedAt")}: ${new Date(completedAt).toLocaleDateString()}`
    );
  }
  if (documents.length > 0) {
    lines.push(
      `${t("review.documents")}: ${documents.map((d) => d.filename).join(", ")}`
    );
  }
  lines.push(
    `${t("review.report.summary")}: ${t("review.report.summaryValue", {
      total: counts.total,
      passed: counts.passed,
      failed: counts.failed,
    })}`
  );
  lines.push("");

  for (const { result, number, depth } of rows) {
    const indent = "  ".repeat(depth);
    const verdict = verdictLabel(result, t);
    lines.push(
      `${indent}${number} ${result.checkList.name}${verdict ? `  [${verdict}]` : ""}`
    );

    // 直すべき点にだけ理由と根拠を添える。合格まで同じ厚みで書くと埋もれる
    if (result.result !== REVIEW_RESULT.FAIL) {
      continue;
    }
    const detail = result.explanation ?? result.shortExplanation;
    if (detail) {
      lines.push(`${indent}  ${t("review.report.reason")}: ${detail}`);
    }
    const sources = formatSources(result, filenameById, t);
    if (sources.length > 0) {
      lines.push(`${indent}  ${t("review.report.source")}: ${sources.join(", ")}`);
    }
    if (result.userOverride && result.userComment) {
      lines.push(`${indent}  ${t("review.userComment")}: ${result.userComment}`);
    }
  }

  return lines.join("\n");
}

/**
 * 書き出した文章を手元に写す。
 *
 * クリップボードは安全な文脈でしか使えず、権限を断られることもある。
 * 写せたかどうかを返し、断られたときは画面側で別の道を出せるようにする
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
