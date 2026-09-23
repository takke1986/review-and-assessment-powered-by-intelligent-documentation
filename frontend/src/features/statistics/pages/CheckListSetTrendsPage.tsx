import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Pagination from "../../../components/Pagination";
import SearchBox from "../../../components/SearchBox";
import ErrorBoundary from "../../../components/ErrorBoundary";
import { useTableSort } from "../../../hooks/useTableSort";
import { useCheckListSetTrends } from "../hooks/useCheckListSetTrends";
import CheckListSetTrendTable from "../components/CheckListSetTrendTable";

/**
 * チェックリストを横断した傾向の一覧。
 *
 * この画面で決めるのは「どのチェックリストに手を入れるか」の1点だけ。
 * 項目ごとの話は /trends/:setId に置く。以前は1画面に選択も項目も
 * 詰めていたが、チェックリストが増えると選択部分だけで画面が埋まった。
 */
export default function CheckListSetTrendsPage() {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [search, setSearch] = useState("");
  const [includeUnreviewed, setIncludeUnreviewed] = useState(false);

  const { sortBy, sortOrder, handleSortChange } = useTableSort({
    defaultSortBy: "actionableCount",
    onSorted: () => setCurrentPage(1),
  });

  const { items, total, totalPages, isLoading, error } = useCheckListSetTrends({
    page: currentPage,
    limit: itemsPerPage,
    sortBy,
    sortOrder,
    search,
    includeUnreviewed,
  });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };





  const emptyMessage = useMemo(() => {
    if (search.trim()) return t("common.noMatch");
    return includeUnreviewed ? t("trends.empty") : t("trends.noReviewedSets");
  }, [search, includeUnreviewed, t]);

  return (
    <div>
      <h1 className="mb-2 text-3xl font-bold">{t("trends.setsTitle")}</h1>
      <p className="mb-6 text-aws-font-color-gray">{t("trends.setsLead")}</p>

      <div className="mb-4">
        <SearchBox value={search} onChange={handleSearchChange} />
      </div>

      <ErrorBoundary label={t("trends.setsTitle")}>
        {error ? (
          <p className="text-red">{t("common.error")}</p>
        ) : isLoading ? (
          <p className="text-aws-font-color-gray">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <p className="text-aws-font-color-gray">{emptyMessage}</p>
        ) : (
          <CheckListSetTrendTable
            items={items}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
          />
        )}
      </ErrorBoundary>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={total}
        itemsPerPage={itemsPerPage}
        onPageChange={setCurrentPage}
        isLoading={isLoading}
      />

      {/* 未審査は既定で畳む。傾向を見る対象が無いため */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            setIncludeUnreviewed(!includeUnreviewed);
            setCurrentPage(1);
          }}
          className="text-sm text-aws-font-color-blue underline">
          {includeUnreviewed
            ? t("trends.hideUnreviewed")
            : t("trends.showUnreviewed")}
        </button>
      </div>
    </div>
  );
}
