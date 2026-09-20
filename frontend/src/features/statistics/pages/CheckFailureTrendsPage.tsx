import { useEffect, useMemo, useState } from "react";
import SearchBox from "../../../components/SearchBox";
import { useTableSort } from "../../../hooks/useTableSort";
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
  [CHECK_TREND_STATUS.MISSES_THINGS]: {
    // 見落としが一番危ない。目で拾えるよう、ほかより強い色にする
    style: "bg-red/10 text-red",
    label: "trends.statusMissesThings",
    action: "trends.actionMissesThings",
    actionable: true,
  },
  [CHECK_TREND_STATUS.TOO_STRICT]: {
    style: "bg-yellow-100 text-yellow-800",
    label: "trends.statusTooStrict",
    action: "trends.actionTooStrict",
    actionable: true,
  },
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

/** 表の列。見出しを押すと並び替える */
const SORTABLE_COLUMNS = [
  { key: "name", label: "trends.item", alignRight: false },
  { key: "status", label: "trends.status", alignRight: false },
  { key: "action", label: "trends.action", alignRight: false },
  { key: "overturned", label: "trends.overturned", alignRight: true },
  { key: "failRate", label: "trends.failRate", alignRight: true },
  { key: "failedCount", label: "trends.failed", alignRight: true },
  { key: "reviewedCount", label: "trends.reviewed", alignRight: true },
  { key: "averageConfidence", label: "trends.confidence", alignRight: true },
  { key: "lastFailedAt", label: "trends.lastFailed", alignRight: false },
] as const;

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

  // この表はページで区切らず全件を持っているので、画面側で並べても正しい。
  // 「すべきこと」は状態から決まるので、状態と同じ並びになる
  const { sortBy, sortOrder, handleSortChange } = useTableSort({
    defaultSortBy: "failRate",
  });

  const sortedItems = useMemo(() => {
    const value = (item: CheckFailureTrendItem) => {
      switch (sortBy) {
        case "name":
          return item.name;
        case "status":
        case "action":
          return t(STATUS_VIEW[item.status].label);
        case "failedCount":
          return item.failedCount;
        case "reviewedCount":
          return item.reviewedCount;
        case "averageConfidence":
          return item.averageConfidence;
        case "overturned":
          // 見落としのほうが重いので、並べたときに上に来るよう重みを付ける
          return item.missedCount * 100 + item.overturnedToPassCount;
        case "lastFailedAt":
          return item.lastFailedAt
            ? new Date(item.lastFailedAt).getTime()
            : null;
        default:
          return item.failRate;
      }
    };
    const direction = sortOrder === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      // 値の無い項目は、どちら向きでも最後に置く（先頭に空欄が並ぶと見たいものが隠れる）
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      if (typeof left === "string" && typeof right === "string") {
        return left.localeCompare(right) * direction;
      }
      return ((left as number) - (right as number)) * direction;
    });
  }, [items, sortBy, sortOrder, t]);

  const todo = useMemo(
    () =>
      items
        .filter((item) => STATUS_VIEW[item.status].actionable)
        // 見落としが最優先。そのまま通っていたら見逃していたものなので
        .sort(
          (a, b) =>
            b.missedCount - a.missedCount ||
            b.overturnedToPassCount - a.overturnedToPassCount ||
            b.failedCount - a.failedCount
        )
        .slice(0, 3),
    [items]
  );

  const percent = (rate: number) => `${Math.round(rate * 100)}%`;

  /**
   * 着眼点の効果をひとことにする。
   *
   * 書いたあと審査していなければ「まだ分からない」と言う。0件を「効いた」と
   * 見せると、次に覆されたときに信用されなくなる
   */
  const guidanceEffectLabel = (
    effect: NonNullable<CheckFailureTrendItem["guidanceEffect"]>
  ) => {
    const written = new Date(effect.writtenAt).toLocaleDateString();
    if (effect.after.reviewed === 0) {
      return t("trends.guidanceNotYetTested", { written });
    }
    if (effect.after.overturned === 0) {
      return t("trends.guidanceWorking", {
        written,
        reviewed: effect.after.reviewed,
      });
    }
    return t("trends.guidanceStillOverturned", {
      written,
      overturned: effect.after.overturned,
      reviewed: effect.after.reviewed,
    });
  };
  const selectedSet = sets.find((set) => set.id === setId);

  // 行き先は状態で変わる。着眼点を書くならその項目、実務の問題なら落ちた審査の結果
  const destination = (item: CheckFailureTrendItem) => {
    // 覆されている項目は、どちらの向きでも着眼点で埋められる。
    // 厳しすぎるなら許容範囲を、見落とすなら見るべき箇所を書く
    if (
      (item.status === CHECK_TREND_STATUS.MISSES_THINGS ||
        item.status === CHECK_TREND_STATUS.TOO_STRICT) &&
      setId
    ) {
      return {
        to: `/checklist/${setId}?item=${item.checkId}`,
        label: t("trends.openGuidance"),
      };
    }
    if (item.status === CHECK_TREND_STATUS.NEEDS_GUIDANCE && setId) {
      return {
        to: `/checklist/${setId}?item=${item.checkId}`,
        label: t("trends.openGuidance"),
      };
    }
    if (
      item.status === CHECK_TREND_STATUS.OPERATIONAL_ISSUE &&
      item.lastFailedReviewJobId
    ) {
      return {
        to: `/review/${item.lastFailedReviewJobId}`,
        label: t("trends.openResults"),
      };
    }
    return null;
  };

  const action = (item: CheckFailureTrendItem) => {
    const link = destination(item);
    return (
      <div className="text-sm">
        <span>{t(STATUS_VIEW[item.status].action)}</span>
        {link && (
          <Link
            to={link.to}
            className="ml-2 text-aws-font-color-blue underline">
            {link.label}
          </Link>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">{t("trends.title")}</h1>

      <div className="mb-6">
        <label
          htmlFor="checklist-search"
          className="mb-1 block text-sm font-medium text-aws-squid-ink-light">
          {t("trends.search")}
        </label>
        <SearchBox id="checklist-search" value={query} onChange={setQuery} />

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
          {/* list-outside にして、折り返した行が番号の下に潜らないようにする。
              打ち手の文は長いので、項目名と地続きにせず行を分ける */}
          <ol className="list-outside list-decimal space-y-2 pl-5 text-sm">
            {todo.map((item) => (
              <li key={item.checkId}>
                <span className="font-medium">{item.name}</span>
                <span className="mt-0.5 block text-aws-font-color-gray">
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
          {/* min-w-full。w-full だと表が画面幅に押し込まれ、横スクロールが
              効かないまま桁が潰れる */}
          <table className="min-w-full text-sm">
            <thead className="bg-aws-paper-light text-left">
              <tr>
                {SORTABLE_COLUMNS.map((column) => (
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
                    className={`px-4 py-3 ${
                      column.alignRight ? "text-right" : ""
                    }`}>
                    <button
                      type="button"
                      onClick={() => handleSortChange(column.key)}
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
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.checkId} className="border-t border-light-gray">
                  <td className="px-4 py-3">
                    {item.name}
                    {item.carriedOverCount > 0 && (
                      <span className="ml-2 rounded-full bg-light-gray px-2 py-1 text-xs text-aws-font-color-gray">
                        {t("trends.carriedOver")} {item.carriedOverCount}
                      </span>
                    )}
                    {/* 着眼点を書いた効果。ここが見えないと、書いた側に
                        効いたかどうかが返らず、次を書く気にならない */}
                    {item.guidanceEffect && (
                      <p className="mt-1 text-xs text-aws-font-color-gray">
                        {guidanceEffectLabel(item.guidanceEffect)}
                      </p>
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
                  <td className="px-4 py-3 text-right text-sm">
                    {/* 向きが分からないと打ち手が決まらないので、数だけでなく
                        どちらに覆されたかを出す */}
                    {item.missedCount === 0 &&
                    item.overturnedToPassCount === 0 ? (
                      "-"
                    ) : (
                      <div className="flex flex-col items-end gap-0.5">
                        {item.missedCount > 0 && (
                          <span className="whitespace-nowrap text-red">
                            {t("trends.missed", { count: item.missedCount })}
                          </span>
                        )}
                        {item.overturnedToPassCount > 0 && (
                          <span className="whitespace-nowrap text-aws-font-color-gray">
                            {t("trends.overturnedToPass", {
                              count: item.overturnedToPassCount,
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
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
