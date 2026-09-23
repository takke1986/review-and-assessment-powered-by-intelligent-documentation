import { useMemo, useState } from "react";
import BarChart, { CHART_COLORS } from "../../../components/BarChart";
import ErrorBoundary from "../../../components/ErrorBoundary";
import Pagination from "../../../components/Pagination";
import { useTableSort } from "../../../hooks/useTableSort";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCheckFailureTrends } from "../hooks/useCheckFailureTrends";
import { useCheckListSetTrends } from "../hooks/useCheckListSetTrends";
import { CheckFailureTrendItem } from "../types";
import { STATUS_VIEW } from "../trendView";
import CheckItemTrendTable from "../components/CheckItemTrendTable";

export default function CheckFailureTrendsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // どのチェックリストを見ているかは URL が持つ。ブックマークと共有ができる
  const setId = useParams<{ setId: string }>().setId ?? null;
  const { items, reviewJobCount, isLoading } = useCheckFailureTrends(setId);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [itemPage, setItemPage] = useState(1);
  const itemsPerPage = 10;

  // 切り替え先の候補。一覧と同じ並び（手を入れる項目の多い順）にしておくと、
  // 前 / 次で辿る順序が一覧と一致する
  const { items: siblings } = useCheckListSetTrends({
    page: 1,
    limit: 100,
    sortBy: "actionableCount",
    sortOrder: "desc",
    search: "",
    includeUnreviewed: false,
  });
  const currentIndex = siblings.findIndex((row) => row.checkListSetId === setId);
  const current = currentIndex >= 0 ? siblings[currentIndex] : undefined;
  const prevSet = currentIndex > 0 ? siblings[currentIndex - 1] : undefined;
  const nextSet =
    currentIndex >= 0 && currentIndex < siblings.length - 1
      ? siblings[currentIndex + 1]
      : undefined;

  // この表はページで区切らず全件を持っているので、画面側で並べても正しい。
  // 「すべきこと」は状態から決まるので、状態と同じ並びになる
  const { sortBy, sortOrder, handleSortChange } = useTableSort({
    defaultSortBy: "failRate",
    // 並べ替えると順番が変わるので、ページを先頭に戻す
    onSorted: () => setItemPage(1),
  });

  const sortedItems = useMemo(() => {
    const value = (item: CheckFailureTrendItem) => {
      switch (sortBy) {
        case "name":
          return item.name;
        case "status":
        case "action":
          return STATUS_VIEW[item.status].rank;
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
      const compared = ((left as number) - (right as number)) * direction;
      if (compared !== 0) {
        return compared;
      }
      // 同じ状態の中では不合格の多い順。塊の中でも手を付ける順が分かる
      return b.failedCount - a.failedCount;
    });
  }, [items, sortBy, sortOrder, t]);

  // 並べ替えは全件に対して効かせ、表示だけをページで区切る。
  // 1ページ目に出るのは「並べ替えた結果の上位10件」で、ページを切ったことで
  // 順位が変わることはない
  const itemTotalPages = Math.max(1, Math.ceil(sortedItems.length / itemsPerPage));
  const pagedItems = useMemo(
    () =>
      sortedItems.slice((itemPage - 1) * itemsPerPage, itemPage * itemsPerPage),
    [sortedItems, itemPage, itemsPerPage]
  );

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
   * 手を入れる価値のある項目を、不合格率の高い順に並べる。
   * 表は全件を出すが、どこから手を付けるかは形で見た方が早い
   */
  const worst = useMemo(
    () =>
      items
        // 一度も落ちていない項目を混ぜると、長さ0の棒が並んで図の半分が
        // 埋まらない。ここに出すのは手を入れる先の候補だけでよい
        .filter((item) => item.reviewedCount > 0 && item.failRate > 0)
        .sort((a, b) => b.failRate - a.failRate)
        .slice(0, 10),
    [items]
  );

  /**
   * 着眼点を書いた項目の、書く前と後の「覆された率」。
   *
   * ここが行動変容の要。書いたら減った、が見えないと次を書く気にならない。
   * 書いたあと一度も審査していない項目は、比べようがないので外す
   */
  const guidanceEffects = useMemo(
    () =>
      items.filter(
        (item) => item.guidanceEffect && item.guidanceEffect.after.reviewed > 0
      ),
    [items]
  );

  const overturnRate = (counts: { reviewed: number; overturned: number }) =>
    counts.reviewed === 0 ? 0 : counts.overturned / counts.reviewed;



  return (
    <div>
      <Link
        to="/trends"
        className="mb-2 inline-block text-sm text-aws-font-color-blue underline">
        ← {t("trends.backToSets")}
      </Link>
      <h1 className="mb-6 text-3xl font-bold">{t("trends.title")}</h1>

      {/* 切り替えは2通り置く。選択で任意のチェックリストへ、前 / 次は一覧の
          並び順をそのまま辿るので「手を入れる順に上から片付ける」使い方ができる。
          チップを並べるのはやめた。数が増えると選択部分だけで画面が埋まるため */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen(!switcherOpen)}
            aria-expanded={switcherOpen}
            className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-light-gray bg-white px-3 py-2 text-left hover:bg-aws-paper-light">
            <span className="truncate font-medium">
              {current?.name ?? t("trends.switchSet")}
            </span>
            <span className="shrink-0 rounded-full bg-aws-paper-light px-2 py-0.5 text-xs text-aws-font-color-gray">
              {t("trends.jobCount", { count: reviewJobCount })}
            </span>
            <span className="shrink-0 text-xs text-aws-font-color-gray">▾</span>
          </button>

          {switcherOpen && (
            <div className="absolute left-0 z-10 mt-1 max-h-72 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-light-gray bg-white shadow-lg">
              <p className="px-3 pt-2 text-xs text-aws-font-color-gray">
                {t("trends.switchHint")}
              </p>
              {siblings.map((row) => (
                <button
                  key={row.checkListSetId}
                  type="button"
                  onClick={() => {
                    setSwitcherOpen(false);
                    navigate(`/trends/${row.checkListSetId}`);
                  }}
                  className={`flex w-full items-center justify-between gap-2 border-t border-light-gray px-3 py-2 text-left text-sm ${
                    row.checkListSetId === setId
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "hover:bg-aws-paper-light"
                  }`}>
                  <span className="min-w-0 truncate">{row.name}</span>
                  {/* 行き先を一覧に戻らずに決められるよう、件数も出す */}
                  <span
                    className={`shrink-0 whitespace-nowrap text-xs ${
                      row.checkListSetId === setId
                        ? "text-aws-font-color-white-light"
                        : "text-aws-font-color-gray"
                    }`}>
                    {t("trends.switchCounts", {
                      reviews: row.reviewJobCount,
                      actionable: row.insufficientData
                        ? t("trends.insufficient")
                        : row.actionableCount,
                    })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {siblings.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!prevSet}
              onClick={() => prevSet && navigate(`/trends/${prevSet.checkListSetId}`)}
              className="rounded-md border border-light-gray bg-white px-3 py-2 text-sm disabled:text-light-gray">
              ◀ {t("trends.prev")}
            </button>
            {currentIndex >= 0 && (
              <span className="whitespace-nowrap text-xs text-aws-font-color-gray">
                {t("trends.positionInList", {
                  current: currentIndex + 1,
                  total: siblings.length,
                })}
              </span>
            )}
            <button
              type="button"
              disabled={!nextSet}
              onClick={() => nextSet && navigate(`/trends/${nextSet.checkListSetId}`)}
              className="rounded-md border border-light-gray bg-white px-3 py-2 text-sm disabled:text-light-gray">
              {t("trends.next")} ▶
            </button>
          </div>
        )}
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

      {guidanceEffects.length > 0 && (
        <ErrorBoundary label={t("trends.guidanceEffectChart")}>
        <div className="mb-6 rounded-lg border border-light-gray bg-white p-4">
          <h2 className="mb-1 font-medium text-aws-squid-ink-light">
            {t("trends.guidanceEffectChart")}
          </h2>
          <p className="mb-3 text-sm text-aws-font-color-gray">
            {t("trends.guidanceEffectChartHint")}
          </p>
          <BarChart
            showLegend
            height={Math.max(160, guidanceEffects.length * 56)}
            horizontal
            ariaLabel={t("trends.guidanceEffectChart")}
            labels={guidanceEffects.map((item) => item.name)}
            datasets={[
              {
                label: t("trends.beforeGuidance"),
                data: guidanceEffects.map((item) =>
                  overturnRate(item.guidanceEffect!.before)
                ),
                backgroundColor: CHART_COLORS.red,
              },
              {
                label: t("trends.afterGuidance"),
                data: guidanceEffects.map((item) =>
                  overturnRate(item.guidanceEffect!.after)
                ),
                backgroundColor: CHART_COLORS.blue,
              },
            ]}
            formatValue={percent}
          />
        </div>
        </ErrorBoundary>
      )}

      {worst.length > 0 && (
        <ErrorBoundary label={t("trends.failRateChart")}>
        <div className="mb-6 rounded-lg border border-light-gray bg-white p-4">
          <h2 className="mb-1 font-medium text-aws-squid-ink-light">
            {t("trends.failRateChart")}
          </h2>
          <p className="mb-3 text-sm text-aws-font-color-gray">
            {t("trends.failRateChartHint")}
          </p>
          {/* 色は状態に合わせる。赤は手を入れる価値があるもの */}
          <BarChart
            horizontal
            height={Math.max(160, worst.length * 36)}
            ariaLabel={t("trends.failRateChart")}
            labels={worst.map((item) => item.name)}
            datasets={[
              {
                label: t("trends.failRate"),
                data: worst.map((item) => item.failRate),
                backgroundColor: worst.map((item) =>
                  STATUS_VIEW[item.status].actionable
                    ? CHART_COLORS.red
                    : CHART_COLORS.gray
                ),
              },
            ]}
            formatValue={percent}
          />
        </div>
        </ErrorBoundary>
      )}

      {/* 表は子コンポーネントにしてから包む。インラインの JSX は親の描画時に
          評価されるので、そのままでは境界の外で例外が出る */}
      <ErrorBoundary label={t("trends.title")}>
        {isLoading ? (
          <p className="text-aws-font-color-gray">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <p className="text-aws-font-color-gray">{t("trends.empty")}</p>
        ) : (
          <CheckItemTrendTable
            items={pagedItems}
            setId={setId}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
          />
        )}
      </ErrorBoundary>

      {/* チェック項目の表のページ送り。共通部品をそのまま使う */}
      {items.length > 0 && (
        <Pagination
          currentPage={itemPage}
          totalPages={itemTotalPages}
          totalItems={sortedItems.length}
          itemsPerPage={itemsPerPage}
          onPageChange={setItemPage}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
