import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HiSearch } from "react-icons/hi";

/** 入力が落ち着くまで待つ時間。短すぎると打っている途中で検索が走る */
const SETTLE_MS = 400;

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** 画面側に label があるときに、htmlFor と対応させる */
  id?: string;
  /** 置き場所ごとに幅や余白が違うので、外から渡せるようにする */
  className?: string;
}

/**
 * 一覧を名前で絞り込む入力欄。
 *
 * 絞り込みはサーバ側で行う。画面側で絞ると、ページ分割された一覧では
 * 表示中のページしか探せず、あるのに「見つからない」と出てしまう。
 *
 * 打っている文字はこの中で持ち、落ち着いてから親に伝える。日本語は変換を
 * 経るので、確定前の「りょ」で検索すると必ず0件になり、入力を続けられない。
 */
export default function SearchBox({
  value,
  onChange,
  id,
  className = "w-full max-w-md",
}: SearchBoxProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  // 変換中かどうか。日本語入力では確定するまで検索しない。
  // ref ではなく state で持つ。ref だと確定しても再描画が起きず、
  // 確定後の文字が変換中と同じ（「テ」→「テ」）ときに検索が走らなかった
  const [isComposing, setIsComposing] = useState(false);

  // 画面側が値を変えたとき（別の条件で絞り直したなど）に追従する
  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (isComposing || text === value) {
      return;
    }
    const timer = setTimeout(() => onChange(text), SETTLE_MS);
    return () => clearTimeout(timer);
    // onChange は画面側で作り直されることがあるので、値の変化だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, value, isComposing]);

  return (
    <div className={`relative ${className}`}>
      {/* 虫眼鏡。枠だけでは、ここが検索の欄だと分からない */}
      <HiSearch
        className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-aws-font-color-gray"
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          setText(event.currentTarget.value);
        }}
        placeholder={t("common.searchPlaceholder")}
        aria-label={t("common.search")}
        className="w-full rounded-full border border-light-gray bg-white py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-aws-sea-blue-light"
      />
    </div>
  );
}
