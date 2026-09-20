import {
  REVIEW_RESULT_STATUS,
  ReviewResultDetail,
} from "../model/review";
import { leafResults } from "./check-item-selection";

/**
 * 審査を「完了」と呼んでよいかを決める。
 *
 * いまのワークフローは、項目が1つでも落ちればジョブ全体を失敗にする
 * （Map に失敗許容の設定を入れていない）。だから本来ここに引っかかる
 * ジョブは無い。それでも検査するのは、守りが1枚しかないから。
 *
 * 「何割までの失敗を許す」設定を入れたり、項目数が増えて Distributed Map
 * に移したりすると、一部の項目が判定されないまま集計に進むようになる。
 * そのとき黙って「完了」と表示されると、人は全項目を見たつもりで書類を
 * 通してしまう。見落としの中でもいちばん質が悪い。
 *
 * 検査して落とせば、審査は「失敗」として表に出る。失敗した審査は続きから
 * 流し直せるので、済んだ項目をやり直す無駄も出ない。
 *
 * 審査するのは子を持たない項目だけなので、判定を確かめるのも葉だけでよい。
 * 親の判定は子から集計して決まる。葉の定義は審査対象を選ぶときと同じものを
 * 使う（定義が2つあると、選ばれないのに判定を求められる項目が生まれる）
 */
export const unjudgedLeaves = (
  results: ReviewResultDetail[]
): ReviewResultDetail[] =>
  leafResults(results).filter(
    (result) => result.status !== REVIEW_RESULT_STATUS.COMPLETED
  );

/**
 * 判定が付いていない項目を、名前と状態で読めるようにする。
 *
 * エラーに項目名を入れておかないと、失敗の記録を見ても
 * 「どの項目が抜けたのか」を調べ直す羽目になる
 */
export const describeUnjudged = (results: ReviewResultDetail[]): string =>
  unjudgedLeaves(results)
    .map((result) => `${result.checkList.name}(${result.status})`)
    .join(", ");
