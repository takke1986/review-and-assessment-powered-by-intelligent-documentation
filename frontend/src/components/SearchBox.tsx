import { useTranslation } from "react-i18next";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** 画面側に label があるときに、htmlFor と対応させる */
  id?: string;
  /** 置き場所ごとに幅が違うので、外から渡せるようにする */
  className?: string;
}

/**
 * 一覧を名前で絞り込む入力欄。
 *
 * 絞り込みはサーバ側で行う。画面側で絞ると、ページ分割された一覧では
 * 表示中のページしか探せず、あるのに「見つからない」と出てしまう。
 */
export default function SearchBox({
  value,
  onChange,
  id,
  className = "w-full max-w-md",
}: SearchBoxProps) {
  const { t } = useTranslation();
  return (
    <input
      id={id}
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={t("common.searchPlaceholder")}
      aria-label={t("common.search")}
      className={`rounded-md border border-light-gray px-3 py-2 ${className}`}
    />
  );
}
