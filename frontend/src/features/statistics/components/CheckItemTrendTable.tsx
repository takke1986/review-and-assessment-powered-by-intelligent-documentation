import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CHECK_TREND_STATUS, CheckFailureTrendItem } from "../types";
import { ITEM_TREND_COLUMNS, STATUS_VIEW } from "../trendView";
import TrendTableHead from "./TrendTableHead";
import { useRowLink } from "../rowLink";

/** これより長い「すべきこと」は折り返して読ませる */
const LONG_ACTION_CHARS = 20;

/**
 * チェック項目の表。
 *
 * ページ本体から切り出してあるのは、ErrorBoundary で包むため。
 * JSX の子要素は親の描画時に評価されるので、インラインで
 * `<ErrorBoundary>{表のJSX}</ErrorBoundary>` と書いても、例外は親の描画中に
 * 出て境界の外になる。別のコンポーネントにして初めて受け止められる。
 */

interface Props {
  items: CheckFailureTrendItem[];
  setId: string | null;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (key: string) => void;
}

export default function CheckItemTrendTable({
  items,
  setId,
  sortBy,
  sortOrder,
  onSortChange,
}: Props) {
  const { t } = useTranslation();
  const rowLink = useRowLink();
  // すべきことには一言のものと数十字の文がある。文があるときだけ読める幅を
  // 取り、一言だけの表では中身の幅に詰めて隣の列との間を空けない
  const actionWidth = items.some(
    (item) => t(STATUS_VIEW[item.status].action).length > LONG_ACTION_CHARS
  )
    ? "min-w-[16rem]"
    : "whitespace-nowrap";
  const percent = (rate: number) => `${Math.round(rate * 100)}%`;

  /**
   * 着眼点の効果をひとことにする。
   *
   * 書いたあと審査していなければ「まだ分からない」と言う。0件を「効いた」と
   * 見せると、次に覆されたときに信用されなくなる
   */
  const guidanceEffectLabel = (
    effect: NonNullable<CheckFailureTrendItem["guidanceEffect"]>
  ) => {
    const written = new Date(effect.writtenAt).toLocaleDateString();
    if (effect.after.reviewed === 0) {
      return t("trends.guidanceNotYetTested", { written });
    }
    if (effect.after.overturned === 0) {
      return t("trends.guidanceWorking", {
        written,
        reviewed: effect.after.reviewed,
      });
    }
    return t("trends.guidanceStillOverturned", {
      written,
      overturned: effect.after.overturned,
      reviewed: effect.after.reviewed,
    });
  };

  // 行き先は状態で変わる。着眼点を書くならその項目、実務の問題なら落ちた審査の結果
  const destination = (item: CheckFailureTrendItem) => {
    // 覆されている項目は、どちらの向きでも着眼点で埋められる。
    // 厳しすぎるなら許容範囲を、見落とすなら見るべき箇所を書く
    if (
      (item.status === CHECK_TREND_STATUS.MISSES_THINGS ||
        item.status === CHECK_TREND_STATUS.TOO_STRICT ||
        item.status === CHECK_TREND_STATUS.NEEDS_GUIDANCE) &&
      setId
    ) {
      return {
        to: `/checklist/${setId}?item=${item.checkId}`,
        label: t("trends.openGuidance"),
      };
    }
    if (
      item.status === CHECK_TREND_STATUS.OPERATIONAL_ISSUE &&
      item.lastFailedReviewJobId
    ) {
      return {
        to: `/review/${item.lastFailedReviewJobId}`,
        label: t("trends.openResults"),
      };
    }
    return null;
  };

  const action = (item: CheckFailureTrendItem) => {
    const link = destination(item);
    return (
      <div className="text-sm">
        <span>{t(STATUS_VIEW[item.status].action)}</span>
        {/* リンクは行を分ける。同じ行に続けると、狭い画面で
            「審査結果を見る」の途中で折り返して読みにくくなる */}
        {link && (
          <Link
            to={link.to}
            className="mt-0.5 block text-aws-font-color-blue underline">
            {link.label}
          </Link>
        )}
      </div>
    );
  };

  return (
    // 日本語はどこでも改行できるので、放っておくとブラウザが「1文字ずつ
    // 折り返せば収まる」と判断して桁が縦に潰れる。短い列は折り返さず、
    // 長い文の列だけ最小幅を与えて読める幅で折り返させる。結果として表は
    // 画面より広くなり、横に送れる
    <div className="overflow-x-auto rounded-lg border border-light-gray bg-white">
      <table className="min-w-full text-sm">
        <TrendTableHead
          columns={ITEM_TREND_COLUMNS}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={onSortChange}
        />
        <tbody>
          {items.map((item) => (
            <tr key={item.checkId} {...rowLink(destination(item)?.to ?? null)}>
              <td className="min-w-[12rem] px-4 py-3">
                {item.name}
                {item.carriedOverCount > 0 && (
                  <span className="ml-2 rounded-full bg-light-gray px-2 py-1 text-xs text-aws-font-color-gray">
                    {t("trends.carriedOver")} {item.carriedOverCount}
                  </span>
                )}
                {/* 着眼点を書いた効果。ここが見えないと、書いた側に効いたか
                    どうかが返らず、次を書く気にならない */}
                {item.guidanceEffect && (
                  <p className="mt-1 text-xs text-aws-font-color-gray">
                    {guidanceEffectLabel(item.guidanceEffect)}
                  </p>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-1 text-xs ${
                    STATUS_VIEW[item.status].style
                  }`}>
                  {t(STATUS_VIEW[item.status].label)}
                </span>
              </td>
              <td className={`${actionWidth} px-4 py-3`}>{action(item)}</td>
              {/* 左寄せにして、すべきことの文のすぐ横に並べる。右寄せだと
                  見出しの幅のぶん間が空き、どの行の数か追いにくい */}
              <td className="whitespace-nowrap px-4 py-3 text-sm">
                {/* 向きが分からないと打ち手が決まらないので、数だけでなく
                    どちらに覆されたかを出す */}
                {item.missedCount === 0 && item.overturnedToPassCount === 0 ? (
                  "-"
                ) : (
                  <div className="flex flex-col items-start gap-0.5">
                    {item.missedCount > 0 && (
                      <span className="whitespace-nowrap text-red">
                        {t("trends.missed", { count: item.missedCount })}
                      </span>
                    )}
                    {item.overturnedToPassCount > 0 && (
                      <span className="whitespace-nowrap text-aws-font-color-gray">
                        {t("trends.overturnedToPass", {
                          count: item.overturnedToPassCount,
                        })}
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-bold">
                {item.reviewedCount === 0 ? "-" : percent(item.failRate)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                {item.failedCount}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                {item.reviewedCount}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                {item.averageConfidence === null
                  ? "-"
                  : percent(item.averageConfidence)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {item.lastFailedAt
                  ? new Date(item.lastFailedAt).toLocaleString()
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
