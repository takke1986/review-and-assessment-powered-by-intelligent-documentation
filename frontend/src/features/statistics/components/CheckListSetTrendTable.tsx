import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckListSetTrendSummary } from "../types";
import { SET_TREND_COLUMNS } from "../trendView";

/**
 * チェックリスト横断一覧の表。
 *
 * ページ本体から切り出してあるのは、ErrorBoundary で包むため。
 * JSX の子要素は親の描画時に評価されるので、インラインで
 * `<ErrorBoundary>{表のJSX}</ErrorBoundary>` と書いても例外は境界の外で出る。
 */

interface Props {
  items: CheckListSetTrendSummary[];
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (key: string) => void;
}

export default function CheckListSetTrendTable({
  items,
  sortBy,
  sortOrder,
  onSortChange,
}: Props) {
  const { t } = useTranslation();
  const percent = (rate: number) => `${Math.round(rate * 100)}%`;

  /** 覆された数は向きが分かるように出す。数だけでは打ち手が決まらない */
  const overturned = (row: CheckListSetTrendSummary) => {
    if (row.missedCount === 0 && row.overturnedToPassCount === 0) {
      return <span className="text-aws-font-color-gray">-</span>;
    }
    return (
      <div className="flex flex-col items-end gap-0.5">
        {row.missedCount > 0 && (
          <span className="whitespace-nowrap text-red">
            {t("trends.missed", { count: row.missedCount })}
          </span>
        )}
        {row.overturnedToPassCount > 0 && (
          <span className="whitespace-nowrap text-aws-font-color-gray">
            {t("trends.overturnedToPass", { count: row.overturnedToPassCount })}
          </span>
        )}
      </div>
    );
  };

  /**
   * 不合格率の帯。数字だけだと差が読み取りにくい。
   * 審査が少ないセットは灰色にして、赤で急かさない
   */
  const failRateCell = (row: CheckListSetTrendSummary) => {
    if (row.failRate === null) {
      return <span className="text-aws-font-color-gray">-</span>;
    }
    const calm = row.insufficientData;
    return (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-16 shrink-0 overflow-hidden rounded bg-light-gray">
          <span
            className={`block h-full ${calm ? "bg-gray" : "bg-red"}`}
            style={{ width: `${Math.round(row.failRate * 100)}%` }}
          />
        </span>
        <span
          className={
            calm
              ? "text-aws-font-color-gray"
              : "whitespace-nowrap font-bold"
          }>
          {percent(row.failRate)}
        </span>
      </div>
    );
  };

  const actionableCell = (row: CheckListSetTrendSummary) => {
    if (row.insufficientData) {
      return (
        <span className="whitespace-nowrap rounded-full bg-light-gray px-2 py-1 text-xs text-aws-font-color-gray">
          {t("trends.insufficient")}
        </span>
      );
    }
    if (row.actionableCount === 0) {
      return <span className="text-aws-font-color-gray">-</span>;
    }
    return (
      <span className="whitespace-nowrap rounded-full bg-light-red px-2 py-1 text-xs text-red">
        {row.actionableCount}
      </span>
    );
  };

  return (
    // 日本語はどこでも改行できるので、短い列は折り返さず、名前の列だけ
    // 最小幅を与えて読める幅で折り返させる。表は画面より広くなり横に送れる
    <div className="overflow-x-auto rounded-lg border border-light-gray bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-aws-paper-light text-left">
          <tr>
            {SET_TREND_COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sortBy === column.key
                    ? sortOrder === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className={`whitespace-nowrap px-4 py-3 ${
                  column.alignRight ? "text-right" : ""
                }`}>
                {column.sortable === false ? (
                  t(column.label)
                ) : (
                  <button
                    type="button"
                    onClick={() => onSortChange(column.key)}
                    className={`flex items-center gap-1 hover:text-aws-font-color-blue ${
                      column.alignRight ? "ml-auto" : ""
                    }`}>
                    {t(column.label)}
                    <span className="text-xs text-aws-font-color-gray">
                      {sortBy === column.key
                        ? sortOrder === "asc"
                          ? "▲"
                          : "▼"
                        : "↕"}
                    </span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.checkListSetId} className="border-t border-light-gray">
              <td className="min-w-[12rem] px-4 py-3">
                <div className="font-medium">{row.name}</div>
                <div className="mt-0.5 text-xs text-aws-font-color-gray">
                  {t("trends.itemCount", { count: row.itemCount })}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                {row.reviewJobCount}
              </td>
              <td className="px-4 py-3">{failRateCell(row)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                {actionableCell(row)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                {overturned(row)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {row.lastReviewedAt
                  ? new Date(row.lastReviewedAt).toLocaleString()
                  : t("trends.neverReviewed")}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {/* 審査が無いセットは開いても何も無いので案内を出さない */}
                {row.reviewJobCount > 0 ? (
                  <Link
                    to={`/trends/${row.checkListSetId}`}
                    className="text-aws-font-color-blue underline">
                    {t("trends.openTrends")}
                  </Link>
                ) : (
                  <span className="text-aws-font-color-gray">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
