import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useChecklistSets } from "../../checklist/hooks/useCheckListSetQueries";
import { useCheckFailureTrends } from "../hooks/useCheckFailureTrends";
import { CHECK_TREND_STATUS, CheckFailureTrendItem } from "../types";

/**
 * 状態ごとの見た目・ラベル・行動。判定そのものはバックエンドが返す。
 * 状態を足すときにここ1箇所だけ直せば済むよう、まとめて持つ。
 */
const STATUS_VIEW: Record<
  CHECK_TREND_STATUS,
  { style: string; label: string; action: string; actionable: boolean }
> = {
  [CHECK_TREND_STATUS.NEEDS_GUIDANCE]: {
    style: "bg-yellow-100 text-yellow-800",
    label: "trends.statusNeedsGuidance",
    action: "trends.actionNeedsGuidance",
    actionable: true,
  },
  [CHECK_TREND_STATUS.OPERATIONAL_ISSUE]: {
    style: "bg-red/10 text-red",
    label: "trends.statusOperationalIssue",
    action: "trends.actionOperationalIssue",
    actionable: true,
  },
  [CHECK_TREND_STATUS.INSUFFICIENT_DATA]: {
    style: "bg-light-gray text-aws-font-color-gray",
    label: "trends.statusInsufficientData",
    action: "trends.actionInsufficientData",
    actionable: false,
  },
  [CHECK_TREND_STATUS.NOT_REVIEWED_RECENTLY]: {
    style: "bg-light-gray text-aws-font-color-gray",
    label: "trends.statusNotReviewedRecently",
    action: "trends.actionNotReviewedRecently",
    actionable: false,
  },
  [CHECK_TREND_STATUS.STABLE]: {
    style: "bg-light-gray text-aws-font-color-gray",
    label: "trends.statusStable",
    action: "trends.actionStable",
    actionable: false,
  },
};

export default function CheckFailureTrendsPage() {
  const { t } = useTranslation();
  const { items: sets, isLoading: isLoadingSets } = useChecklistSets(1, 100);
  const [setId, setSetId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { items, reviewJobCount, isLoading } = useCheckFailureTrends(setId);

  useEffect(() => {
    if (!setId && sets.length > 0) {
      setSetId(sets[0].id);
    }
  }, [sets, setId]);

  // 数が増えるとドロップダウンでは探せないので、名前で絞り込む
  const matchedSets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sets;
    return sets.filter((set) => set.name.toLowerCase().includes(needle));
  }, [sets, query]);

  const todo = useMemo(
    () =>
      items
        .filter((item) => STATUS_VIEW[item.status].actionable)
        .sort((a, b) => b.failedCount - a.failedCount)
        .slice(0, 3),
    [items]
  );

  const percent = (rate: number) => `${Math.round(rate * 100)}%`;
  const selectedSet = sets.find((set) => set.id === setId);

  const action = (item: CheckFailureTrendItem) => (
    <div className="text-sm">
      <span>{t(STATUS_VIEW[item.status].action)}</span>
      {STATUS_VIEW[item.status].actionable && setId && (
        <Link
          to={`/checklist/${setId}`}
          className="ml-2 text-aws-font-color-blue underline">
          {t("trends.openChecklist")}
        </Link>
      )}
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">{t("trends.title")}</h1>

      <div className="mb-6">
        <label
          htmlFor="checklist-search"
          className="mb-1 block text-sm font-medium text-aws-squid-ink-light">
          {t("trends.search")}
        </label>
        <input
          id="checklist-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={isLoadingSets || sets.length === 0}
          placeholder={t("trends.searchPlaceholder")}
          className="w-full max-w-md rounded-md border border-light-gray px-3 py-2"
        />

        {matchedSets.length === 0 ? (
          <p className="mt-2 text-sm text-aws-font-color-gray">
            {t("trends.noMatch")}
          </p>
        ) : (
          <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {matchedSets.map((set) => (
              <button
                key={set.id}
                type="button"
                onClick={() => setSetId(set.id)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  set.id === setId
                    ? "border-aws-sea-blue-light bg-aws-sea-blue-light text-aws-font-color-white-light"
                    : "border-light-gray bg-white text-aws-squid-ink-light hover:bg-aws-paper-light"
                }`}>
                {set.name}
              </button>
            ))}
          </div>
        )}

        <p className="mt-2 text-sm text-aws-font-color-gray">
          {selectedSet ? `${selectedSet.name} — ` : ""}
          {t("trends.jobCount", { count: reviewJobCount })}
        </p>
      </div>

      {todo.length > 0 && (
        <div className="mb-6 rounded-lg border border-light-gray bg-aws-paper-light p-4">
          <h2 className="mb-2 font-medium text-aws-squid-ink-light">
            {t("trends.action")}
          </h2>
          <ol className="list-inside list-decimal space-y-1 text-sm">
            {todo.map((item) => (
              <li key={item.checkId}>
                <span className="font-medium">{item.name}</span>
                <span className="ml-2 text-aws-font-color-gray">
                  {t(STATUS_VIEW[item.status].label)} /{" "}
                  {t(STATUS_VIEW[item.status].action)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {isLoading ? (
        <p className="text-aws-font-color-gray">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-aws-font-color-gray">{t("trends.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-light-gray bg-white">
          <table className="w-full text-sm">
            <thead className="bg-aws-paper-light text-left">
              <tr>
                <th className="px-4 py-3">{t("trends.item")}</th>
                <th className="px-4 py-3">{t("trends.status")}</th>
                <th className="px-4 py-3">{t("trends.action")}</th>
                <th className="px-4 py-3 text-right">{t("trends.failRate")}</th>
                <th className="px-4 py-3 text-right">{t("trends.failed")}</th>
                <th className="px-4 py-3 text-right">{t("trends.reviewed")}</th>
                <th className="px-4 py-3 text-right">
                  {t("trends.confidence")}
                </th>
                <th className="px-4 py-3">{t("trends.lastFailed")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.checkId} className="border-t border-light-gray">
                  <td className="px-4 py-3">
                    {item.name}
                    {item.carriedOverCount > 0 && (
                      <span className="ml-2 rounded-full bg-light-gray px-2 py-1 text-xs text-aws-font-color-gray">
                        {t("trends.carriedOver")} {item.carriedOverCount}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-1 text-xs ${
                        STATUS_VIEW[item.status].style
                      }`}>
                      {t(STATUS_VIEW[item.status].label)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{action(item)}</td>
                  <td className="px-4 py-3 text-right font-bold">
                    {item.reviewedCount === 0 ? "-" : percent(item.failRate)}
                  </td>
                  <td className="px-4 py-3 text-right">{item.failedCount}</td>
                  <td className="px-4 py-3 text-right">{item.reviewedCount}</td>
                  <td className="px-4 py-3 text-right">
                    {item.averageConfidence === null
                      ? "-"
                      : percent(item.averageConfidence)}
                  </td>
                  <td className="px-4 py-3">
                    {item.lastFailedAt
                      ? new Date(item.lastFailedAt).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
