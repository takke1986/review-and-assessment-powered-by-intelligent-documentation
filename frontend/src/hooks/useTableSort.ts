import { useState } from "react";

/**
 * 一覧の並び替え。
 *
 * 並べるのはサーバ側なので、状態は画面が持って API に渡す。
 * 同じ列をもう一度押したら向きを反転し、別の列なら降順から始める
 * （押すたびに向きが変わると、いまどちらで並んでいるのか見失う）。
 */
export function useTableSort(params: {
  defaultSortBy: string;
  defaultSortOrder?: "asc" | "desc";
  /** 並び替えると順番が変わるので、ページを先頭に戻す */
  onSorted?: () => void;
}) {
  const [sortBy, setSortBy] = useState(params.defaultSortBy);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(
    params.defaultSortOrder ?? "desc"
  );

  const handleSortChange = (key: string) => {
    if (key === sortBy) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortOrder("desc");
    }
    params.onSorted?.();
  };

  return { sortBy, sortOrder, handleSortChange };
}
