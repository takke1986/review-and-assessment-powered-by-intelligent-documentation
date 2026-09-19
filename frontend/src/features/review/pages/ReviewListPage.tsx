import React, { useEffect, useState } from "react";
import { useTableSort } from "../../../hooks/useTableSort";
import SearchBox from "../../../components/SearchBox";
import { useNavigate, useLocation } from "react-router-dom";
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

  const { sortBy, sortOrder, handleSortChange } = useTableSort({
    defaultSortBy: "id",
    onSorted: () => setCurrentPage(1),
  });

  const {
    items: reviewJobs,
    total,
    page,
    limit,
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
    search
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
      <div className="mb-6 flex items-center justify-between">
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
