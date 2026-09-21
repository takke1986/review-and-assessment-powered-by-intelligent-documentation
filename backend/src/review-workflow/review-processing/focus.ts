import { ReviewResultDetail } from "../../api/features/review/domain/model/review";
import { leafResults } from "../../api/features/review/domain/service/check-item-selection";

/**
 * 読み取りに渡す「見るべき観点」。
 *
 * 書類を先に読み取るとき、何を審査するのかを知らないと、当たり障りの
 * ない書き取りになる。読んだ文章に欲しいことが無ければ、審査のときに
 * 結局その画像やページを開くことになり、上限と費用に跳ね返る。
 *
 * チェック項目の名前だけを渡す。説明文まで渡すと読み取りの指示が長くなり、
 * 本来の「書いてあることを写す」から離れていく。
 *
 * 数と長さを絞るのは、項目が数百ある場合に指示が膨らんで、読み取り自体の
 * 費用が増えるため。並びは審査する順のままにして、途中で切る
 */
export const MAX_FOCUS_ITEMS = 40;
export const MAX_FOCUS_LENGTH = 60;

export const focusFor = (results: ReviewResultDetail[]): string[] =>
  leafResults(results)
    .map((result) => (result.checkList.name || "").trim())
    .filter((name) => name.length > 0)
    .slice(0, MAX_FOCUS_ITEMS)
    .map((name) =>
      name.length > MAX_FOCUS_LENGTH ? `${name.slice(0, MAX_FOCUS_LENGTH)}…` : name
    );
