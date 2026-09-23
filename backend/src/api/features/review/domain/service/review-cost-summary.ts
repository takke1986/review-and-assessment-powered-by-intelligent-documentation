import type { ReviewCostSummary } from "../repository";

/** 集計の元になる、ジョブ1件の費用に関わる部分 */
export interface ReviewCostRow {
  id: string;
  name: string;
  createdAt: Date;
  /** 実行中や失敗したジョブには入っていない */
  totalCost: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  checkListSetId: string;
  checkListSetName: string;
  /** この審査がどの部署の仕事か。部署を使わない運用では無い */
  departmentId: string | null;
}

/** 内訳に出す上限。全部出しても読めない */
const TOP_JOB_COUNT = 10;

/**
 * 利用者の暦に合わせて年月を取り出す。
 *
 * サーバは UTC で動くので、そのまま月を取ると日本では毎月1日の朝9時までが
 * 前の月に入る。画面の「今月」は利用者の時間帯で切っているので、そちらに
 * 揃えないと、絞り込んだ期間と月の内訳が食い違う。
 *
 * offsetMinutes は JavaScript の getTimezoneOffset と同じ向き
 * （UTC からの遅れが正。日本は -540）
 */
export function monthKey(date: Date, offsetMinutes: number): string {
  const shifted = new Date(date.getTime() - offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = `${shifted.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * ジョブの一覧から費用の内訳を作る。
 *
 * 総額だけでは打ち手にならないので、月ごとの動きと、どのチェックリストに
 * 掛かっているかを併せて出す
 */
export function summarizeCost(
  rows: ReviewCostRow[],
  offsetMinutes = 0
): ReviewCostSummary {
  const months = new Map<string, { totalCost: number; jobCount: number }>();
  const checklists = new Map<
    string,
    { name: string; totalCost: number; jobCount: number }
  >();
  const departments = new Map<
    string,
    { totalCost: number; jobCount: number }
  >();
  // 部署の付いていない審査。合計には入るが内訳には入らないので、別に数える
  const withoutDepartment = { totalCost: 0, jobCount: 0 };
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const row of rows) {
    // 費用が未記録のジョブも件数には数える。実行中のものを隠すと
    // 「件数が合わない」と見えてしまう
    const cost = row.totalCost ?? 0;
    totalCost += cost;
    totalInputTokens += row.totalInputTokens ?? 0;
    totalOutputTokens += row.totalOutputTokens ?? 0;

    const key = monthKey(row.createdAt, offsetMinutes);
    const month = months.get(key) ?? { totalCost: 0, jobCount: 0 };
    month.totalCost += cost;
    month.jobCount += 1;
    months.set(key, month);

    const checklist = checklists.get(row.checkListSetId) ?? {
      name: row.checkListSetName,
      totalCost: 0,
      jobCount: 0,
    };
    checklist.totalCost += cost;
    checklist.jobCount += 1;
    checklists.set(row.checkListSetId, checklist);

    // 部署の付いていない審査は、部署の一覧には足さない。「未所属」という
    // 部署があるように見せると、実在する部署と並んで紛らわしい。
    // ただし数えないと内訳が合計に届かない理由が分からなくなるので、別に数える
    if (row.departmentId) {
      const department = departments.get(row.departmentId) ?? {
        totalCost: 0,
        jobCount: 0,
      };
      department.totalCost += cost;
      department.jobCount += 1;
      departments.set(row.departmentId, department);
    } else {
      withoutDepartment.totalCost += cost;
      withoutDepartment.jobCount += 1;
    }
  }

  return {
    total: {
      totalCost,
      jobCount: rows.length,
      averageCost: rows.length === 0 ? 0 : totalCost / rows.length,
      totalInputTokens,
      totalOutputTokens,
    },
    byMonth: [...months.entries()]
      .map(([month, values]) => ({ month, ...values }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    byDepartment: [...departments.entries()]
      .map(([departmentId, values]) => ({ departmentId, ...values }))
      .sort((a, b) => b.totalCost - a.totalCost),
    withoutDepartment,
    byChecklist: [...checklists.entries()]
      .map(([checkListSetId, values]) => ({ checkListSetId, ...values }))
      .sort((a, b) => b.totalCost - a.totalCost),
    topJobs: rows
      .filter((row) => row.totalCost !== null && row.totalCost > 0)
      .sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0))
      .slice(0, TOP_JOB_COUNT)
      .map((row) => ({
        id: row.id,
        name: row.name,
        totalCost: row.totalCost ?? 0,
        createdAt: row.createdAt,
      })),
  };
}
