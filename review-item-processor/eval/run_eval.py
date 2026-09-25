"""評価セットを流して、判定が正解とどれだけ合うかを測る。

審査の中核（process_review_from_local）を手元で直接呼ぶ。Bedrock を実際に
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
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from statistics import median

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

os.environ.setdefault("BEDROCK_REGION", "us-west-2")  # 本番と同じ

import agent  # noqa: E402

MODES = {"structured": "1", "legacy": "0"}


def run_case(case: dict, mode: str, model_id: str | None) -> dict:
    # 構造化出力の切り替えは呼ぶたびに環境変数を読む。同じプロセスの中で
    # 両方を流すので、ケースごとに直前で決める（並列では同じモードだけ流す）
    os.environ["REVIEW_STRUCTURED_OUTPUT"] = MODES[mode]
    started = time.time()
    try:
        result = agent.process_review_from_local(
            [str(HERE / "fixtures" / case["file"])],
            case["check"]["name"],
            case["check"]["description"],
            language_name="日本語",
            model_id=model_id,
        )
        error = None
    except Exception as e:  # noqa: BLE001 - 評価では落ちたことも結果として残す
        result, error = {}, f"{type(e).__name__}: {e}"
    meta = result.get("reviewMeta") or {}
    explanation = str(result.get("explanation") or "")
    # 答えを読めなかった印。読めなければ不合格として扱うので、正解が不合格の
    # ケースでは「たまたま正解」になる。実際、偽の答えに引きずられて "pass" と
    # 書き、JSON が壊れて読めずに不合格になった例があった。正解には数えない
    unreadable = (
        "Failed to analyze JSON parse" in str(result.get("shortExplanation"))
        or "could not be read" in explanation
    )
    return {
        "id": case["id"],
        "category": case["category"],
        "mode": mode,
        "expected": case["expected"],
        "result": result.get("result"),
        "correct": result.get("result") == case["expected"] and not unreadable,
        "confidence": result.get("confidence"),
        "shortExplanation": result.get("shortExplanation"),
        "explanation": explanation[:400],
        "unreadable": unreadable,
        "error": error,
        "seconds": round(time.time() - started, 1),
        "cost": meta.get("total_cost"),
        "inputTokens": result.get("inputTokens"),
        "outputTokens": result.get("outputTokens"),
        "cacheReadTokens": meta.get("cache_read_tokens"),
        "cacheWriteTokens": meta.get("cache_write_tokens"),
    }


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
    args = parser.parse_args()

    cases = json.loads((HERE / "cases.json").read_text())
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    modes = ["structured", "legacy"] if args.mode == "both" else [args.mode]

    rows: list[dict] = []
    for mode in modes:
        jobs = [c for c in cases for _ in range(args.repeat)]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            rows += list(pool.map(lambda c: run_case(c, mode, args.model), jobs))

    out = HERE / "results" / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(
        {"model": args.model or agent.DOCUMENT_MODEL_ID, "repeat": args.repeat, "rows": rows},
        ensure_ascii=False, indent=1))
    summarize(rows)
    print(f"\n結果: {out}")


if __name__ == "__main__":
    main()
