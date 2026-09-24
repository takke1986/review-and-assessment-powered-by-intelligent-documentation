import { useTranslation } from "react-i18next";
import { TrendColumn } from "../trendView";

interface Props {
  columns: TrendColumn[];
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (key: string) => void;
}

/**
 * 傾向の表の見出し。見出しを押すと並び替える。
 * 横断一覧と項目ごとの表で同じ形にするため、ここにまとめてある
 */
export default function TrendTableHead({
  columns,
  sortBy,
  sortOrder,
  onSortChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <thead className="bg-aws-paper-light text-left">
      <tr>
        {columns.map((column) => (
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
  );
}
