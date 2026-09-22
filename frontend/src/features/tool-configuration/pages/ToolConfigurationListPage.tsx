import { useUserPreference } from "../../user-preference/hooks/useUserPreferenceQueries";
import { useEffect, useState } from "react";
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
  // 管理者かどうかはサーバが決める。画面がトークンから自分で読むと、
  // サーバの判断とずれる
  const { preference } = useUserPreference();
  const isAdmin = preference?.isAdmin ?? false;

  // 画面表示時またはlocationが変わった時にデータを再取得
  useEffect(() => {
    refetch();
  }, [location, refetch]);

  const handleDelete = async (id: string, _name: string) => {
    await deleteToolConfiguration(id);
    refetch();
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-3xl font-bold">{t("toolConfiguration.title")}</h1>
        {/* 全員が使う共有の設定なので、作れるのは管理者だけ。
            押しても必ず失敗するボタンは見せない。
            本当の関門はサーバ側にある（画面を書き換えても通らない） */}
        {isAdmin && (
          <Button onClick={() => navigate("/tool-configurations/new")}>
            <HiPlus className="mr-2 h-5 w-5" />
            {t("toolConfiguration.create")}
          </Button>
        )}
      </div>

      <div className="mb-4">
        <SearchBox value={search} onChange={handleSearchChange} />
      </div>

      <ToolConfigurationList
        toolConfigurations={toolConfigurations}
        isLoading={isLoading}
        onDelete={isAdmin ? handleDelete : undefined}
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
