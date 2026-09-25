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
import re
import os
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from statistics import median

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

os.environ.setdefault("BEDROCK_REGION", "us-west-2")  # 本番と同じ

import agent  # noqa: E402
from cases import cases as load_cases  # noqa: E402
from predigest import predigest  # noqa: E402

# どの経路で読ませたか（文書を丸ごと渡す／道具で読ませる／file_read）。
# 長い書類のケースが本当に道具の経路を通ったかを確かめるため、
# スレッドごとに記録する
_route = threading.local()
_choose_route = agent._choose_route


def _recording_choose_route(*args, **kwargs):
    _route.value = _choose_route(*args, **kwargs)
    return _route.value


agent._choose_route = _recording_choose_route

# 丸ごと渡せない書類（100ページ超など）は、途中で道具の経路に切り替わる。
# 最初の選択だけでなく、実際に道具で読ませたかも記録する
_run_with_tools = agent._run_agent_with_document_tools


def _recording_run_with_tools(*args, **kwargs):
    _route.value = "document_tools"
    return _run_with_tools(*args, **kwargs)


agent._run_agent_with_document_tools = _recording_run_with_tools

MODES = {"structured": "1", "legacy": "0"}


def run_case(case: dict, mode: str, model_id: str | None, use_predigest: bool) -> dict:
    # 構造化出力の切り替えは呼ぶたびに環境変数を読む。同じプロセスの中で
    # 両方を流すので、ケースごとに直前で決める（並列では同じモードだけ流す）
    os.environ["REVIEW_STRUCTURED_OUTPUT"] = MODES[mode]
    started = time.time()
    _route.value = None
    paths = [str(HERE / "fixtures" / name) for name in case["files"]]
    try:
        # 検証環境と同じく、前読みが要る書類（長い・スキャン）は先に読み取る。
        # 見るべき観点は、検証環境ではジョブの項目名。ここでは項目1つ
        digests = predigest(paths, [case["check"]["name"]]) if use_predigest else {}
        result = agent.process_review_from_local(
            paths,
            case["check"]["name"],
            case["check"]["description"],
            language_name="日本語",
            model_id=model_id,
            digests=digests or None,
        )
        error = None
    except Exception as e:  # noqa: BLE001 - 評価では落ちたことも結果として残す
        result, error = {}, f"{type(e).__name__}: {e}"
    meta = result.get("reviewMeta") or {}
    explanation = str(result.get("explanation") or "")
    # 答えを読めなかった印。読めなければ不合格として扱うので、正解が不合格の
    # ケースでは「たまたま正解」になる。実際、偽の答えに引きずられて "pass" と
    # 書き、JSON が壊れて読めずに不合格になった例があった。正解には数えない
    # 読んでいない部分があるのに「全ページ」「すべて」を確認したと書いたか
    coverage = meta.get("coverage") or []
    incomplete = [c for c in coverage if c["read"] < c["total"]]
    # 文ごとに見る。「全120ページ）を全文検索および直接読み取りにより確認」の
    # ように、全体を指す語と確認の語が離れて書かれることがある
    overclaim = bool(incomplete) and any(
        re.search(r"全\s*\d*\s*(ページ|頁)|全文|すべてのページ|全体", sentence)
        and re.search(r"確認|読|精査|検討", sentence)
        for sentence in re.split(r"[。\n]", explanation)
    )
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
        "route": _route.value,
        "coverage": coverage,
        "overclaim": overclaim,
        # 道具を呼んだ回数。読み回るほど入力が増える
        "toolCalls": len(
            ((result.get("verificationDetails") or {}).get("sourcesDetails")) or []
        ),
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
              f"  読んでいない範囲まで確認と書いた {sum(r['overclaim'] for r in items)}"
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


if __name__ == "__main__":
    main()
