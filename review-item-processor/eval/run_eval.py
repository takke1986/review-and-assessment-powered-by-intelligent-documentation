"""評価セットを流して、判定が正解とどれだけ合うかを測る。

検証環境と同じ入口（agent.process_review）を、S3 の代わり（local_s3.py）を差し込んで呼ぶ。Bedrock を実際に
呼ぶので費用がかかる（1ケース数円）。本番のデータは使わない。

    cd review-item-processor
    .venv/bin/python eval/run_eval.py                   # 構造化出力あり・なしの両方
    .venv/bin/python eval/run_eval.py --mode structured --repeat 2
    .venv/bin/python eval/run_eval.py --only inject-fake-json,amount-missing

結果は eval/results/ に JSON で残る。比べたいときは、変更の前後で流して
見比べる。
"""

import argparse
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from statistics import median

# harness を先に読む（import の探し場所を足し、審査の関数に差し込む）
from harness import HERE, agent, run_case
from cases import cases as load_cases  # noqa: E402

def summarize(rows: list[dict]) -> None:
    by_mode = defaultdict(list)
    for row in rows:
        by_mode[row["mode"]].append(row)
    for mode, items in by_mode.items():
        total = len(items)
        correct = sum(r["correct"] for r in items)
        cost = sum(r["cost"] or 0 for r in items)
        print(f"\n== {mode}: 正解 {correct}/{total}"
              f"  読めない答え {sum(r['unreadable'] for r in items)}"
              f"  エラー {sum(bool(r['error']) for r in items)}"
              f"  読んでいない範囲まで確認と書いた {sum(r['overclaim'] for r in items)}"
              f"  前読みが使われなかった {sum(r['readAheadUnused'] for r in items)}"
              f"  費用 ${cost:.3f}  平均 {sum(r['seconds'] for r in items) / total:.1f}秒")
        # 費用は、同じ文書を続けて流すとキャッシュが効いて安く出る。方式どうしを
        # 比べるのはトークン数で行う（入力はキャッシュ分も含めた量）
        print(f"   入力トークン中央値 {median(r['inputTokens'] or 0 for r in items):.0f}"
              f"  出力トークン中央値 {median(r['outputTokens'] or 0 for r in items):.0f}"
              f"  キャッシュ読み {sum(r['cacheReadTokens'] or 0 for r in items)}")
        by_cat = defaultdict(list)
        for r in items:
            by_cat[r["category"]].append(r)
        for cat, rs in sorted(by_cat.items()):
            print(f"   {cat:12s} {sum(r['correct'] for r in rs)}/{len(rs)}")
        for r in items:
            if not r["correct"]:
                print(f"   ✗ {r['id']}: 期待 {r['expected']} → {r['result']}"
                      f" ({r['confidence']}) {r['shortExplanation'] or r['error']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["structured", "legacy", "both"], default="both")
    parser.add_argument("--only", help="カンマ区切りのケースID")
    parser.add_argument("--repeat", type=int, default=1, help="同じケースを何回流すか（揺れを見る）")
    parser.add_argument("--model", default=None, help="モデルID。省略時は本番と同じ既定")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--no-predigest",
        action="store_true",
        help="前読みを作らない（検証環境と違う形で審査される。前読みの効果を見るとき）",
    )
    args = parser.parse_args()

    cases = load_cases()
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    modes = ["structured", "legacy"] if args.mode == "both" else [args.mode]

    rows: list[dict] = []
    for mode in modes:
        jobs = [c for c in cases for _ in range(args.repeat)]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            rows += list(pool.map(
                lambda c: run_case(c, mode, args.model, not args.no_predigest), jobs
            ))

    out = HERE / "results" / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(
        {"model": args.model or agent.DOCUMENT_MODEL_ID, "repeat": args.repeat, "rows": rows},
        ensure_ascii=False, indent=1))
    summarize(rows)
    print(f"\n結果: {out}")
    # 正解数だけでは見逃す不具合がある。前読みの受け渡しが漏れても、短い
    # スキャン書類は丸ごと画像で渡せば正解してしまう。使われなかったら失敗で終える
    unused = [r["id"] for r in rows if r["readAheadUnused"]]
    if unused:
        print(f"\n前読みが使われなかったケース: {sorted(set(unused))}")
        sys.exit(2)


if __name__ == "__main__":
    main()
