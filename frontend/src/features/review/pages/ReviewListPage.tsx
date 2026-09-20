import React, { useEffect, useState } from "react";
import { useTableSort } from "../../../hooks/useTableSort";
import SearchBox from "../../../components/SearchBox";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Button from "../../../components/Button";
import { ReviewJobList } from "../components/ReviewJobList";
import { useReviewJobs } from "../hooks/useReviewJobQueries";
import { useJobCompletionNotice } from "../hooks/useJobCompletionNotice";
import Pagination from "../../../components/Pagination";
import { HiPlus, HiDocumentText } from "react-icons/hi";
import { ErrorAlert } from "../../../components/ErrorAlert";

export const ReviewListPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [search, setSearch] = useState("");
  // 費用の内訳から「この審査が高い」で飛んでくる
  const query = new URLSearchParams(location.search);
  const checkListSetId = query.get("checkListSetId");
  const departmentId = query.get("departmentId");

  const { sortBy, sortOrder, handleSortChange } = useTableSort({
    defaultSortBy: "id",
    onSorted: () => setCurrentPage(1),
  });

  const {
    items: reviewJobs,
    total,
    totalPages,
    refetch: revalidate,
    isLoading,
    error,
  } = useReviewJobs(
    currentPage,
    itemsPerPage,
    sortBy,
    sortOrder,
    undefined,
    search,
    checkListSetId ?? undefined,
    departmentId ?? undefined
  );

  // 一覧を開いたままにしておけば、どのジョブが終わっても気づける
  useJobCompletionNotice(reviewJobs);


  // 絞り込むと件数が減るので、ページを戻さないと空のページを見ることになる
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  // 画面表示時またはlocationが変わった時にデータを再取得
  useEffect(() => {
    // 新規作成後に一覧画面に戻ってきた場合など、locationが変わった時にデータを再取得
    revalidate();
  }, [location, revalidate]);

  const handleJobClick = (job: any) => {
    console.log("Job selected:", job.id);
    navigate(`/review/${job.id}`);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center">
            <HiDocumentText className="mr-2 h-8 w-8 text-aws-font-color-light dark:text-aws-font-color-dark" />
            <h1 className="text-3xl font-bold text-aws-font-color-light dark:text-aws-font-color-dark">
              {t("review.title")}
            </h1>
          </div>
          <p className="mt-2 text-aws-font-color-gray">
            {t("review.description")}
          </p>
        </div>
        <Button
          variant="primary"
          to="/review/create"
          icon={<HiPlus className="h-5 w-5" />}>
          {t("review.create")}
        </Button>
      </div>

      <div className="mb-4">
        <SearchBox value={search} onChange={handleSearchChange} />
      </div>

      {/* 絞り込んで来たことが分かるようにする。黙って一部だけ出すと
          「ジョブが消えた」と見える */}
      {(checkListSetId || departmentId) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-light-gray bg-aws-paper-light px-4 py-2 text-sm">
          <span className="text-aws-font-color-gray">
            {departmentId
              ? `${t("review.filterByDepartment")}: ${departmentId}`
              : `${t("review.filterByChecklist")}${
                  reviewJobs[0] ? `: ${reviewJobs[0].checkListSet.name}` : ""
                }`}
          </span>
          <Link
            to="/review"
            className="text-aws-font-color-blue hover:underline">
            {t("review.clearFilter")}
          </Link>
        </div>
      )}

      {error ? (
        <ErrorAlert
          error={error}
          title={t("review.loadError")}
          message={t("review.loadErrorMessage")}
          retry={revalidate}
        />
      ) : (
        <>
          <ReviewJobList
            emptyMessage={search.trim() ? t("common.noMatch") : undefined}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
            jobs={reviewJobs}
            onJobClick={handleJobClick}
            revalidate={revalidate}
            isLoading={isLoading}
          />

          {/* ページネーション */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={total}
            itemsPerPage={itemsPerPage}
            onPageChange={setCurrentPage}
            isLoading={isLoading}
          />
        </>
      )}
    </div>
  );
};

export default ReviewListPage;
