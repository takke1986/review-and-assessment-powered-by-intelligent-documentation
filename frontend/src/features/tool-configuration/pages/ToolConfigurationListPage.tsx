import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HiPlus } from "react-icons/hi";
import { useToolConfigurations } from "../hooks/useToolConfigurationQueries";
import { useDeleteToolConfiguration } from "../hooks/useToolConfigurationMutations";
import ToolConfigurationList from "../components/ToolConfigurationList";
import Button from "../../../components/Button";
import SearchBox from "../../../components/SearchBox";
import Pagination from "../../../components/Pagination";
import { useTableSort } from "../../../hooks/useTableSort";

export default function ToolConfigurationListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [search, setSearch] = useState("");
  const { sortBy, sortOrder, handleSortChange } = useTableSort({
    defaultSortBy: "createdAt",
    onSorted: () => setCurrentPage(1),
  });

  const { toolConfigurations, total, totalPages, isLoading, refetch } =
    useToolConfigurations({
      page: currentPage,
      limit: itemsPerPage,
      sortBy,
      sortOrder,
      search,
    });

  // 絞り込むと件数が減るので、ページを戻さないと空のページを見ることになる
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };
  const { deleteToolConfiguration } = useDeleteToolConfiguration();

  // 画面表示時またはlocationが変わった時にデータを再取得
  useEffect(() => {
    refetch();
  }, [location, refetch]);

  const handleDelete = async (id: string, name: string) => {
    await deleteToolConfiguration(id);
    refetch();
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("toolConfiguration.title")}</h1>
        <Button onClick={() => navigate("/tool-configurations/new")}>
          <HiPlus className="mr-2 h-5 w-5" />
          {t("toolConfiguration.create")}
        </Button>
      </div>

      <div className="mb-4">
        <SearchBox value={search} onChange={handleSearchChange} />
      </div>

      <ToolConfigurationList
        toolConfigurations={toolConfigurations}
        isLoading={isLoading}
        onDelete={handleDelete}
        emptyMessage={search.trim() ? t("common.noMatch") : undefined}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={handleSortChange}
      />

      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={total}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
        />
      )}
    </div>
  );
}
