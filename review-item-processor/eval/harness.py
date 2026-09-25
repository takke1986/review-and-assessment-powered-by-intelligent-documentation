"""評価で審査を1件流し、何が起きたかを記録する。

検証環境と同じ入口（agent.process_review）を通すため、次を差し込む:
- boto3 の S3 client を、手元のファイルを返す代わり（local_s3.py）にする
- どの経路で読ませたか（丸ごと渡す／道具で読む／file_read）を記録する
- 前読みを読み込めたかを記録する（置いたのに使われなかったら、受け渡しの漏れ）

差し込みは import した時点で効く。run_eval.py から使う
"""

import os
import re
import sys
import threading
import time
import uuid
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

os.environ.setdefault("BEDROCK_REGION", "us-west-2")  # 本番と同じ

import agent  # noqa: E402
from predigest import predigest  # noqa: E402
from local_s3 import LocalS3  # noqa: E402
import digest_store  # noqa: E402
from document_digest import to_json  # noqa: E402

# 検証環境と同じ入口（process_review）を通すため、S3 の代わりを差し込む。
# 入口は boto3.client("s3") で書類を落とし、同じ client で前読みを読む
BUCKET = "eval-documents"
_local_s3 = LocalS3()
_boto3_client = agent.boto3.client


def _client(service, *args, **kwargs):
    return _local_s3 if service == "s3" else _boto3_client(service, *args, **kwargs)


agent.boto3.client = _client

# 前読みを作ったのに審査で使われなかったかを見るため、読み込めた数を記録する
_load_for_documents = digest_store.load_for_documents


def _recording_load(*args, **kwargs):
    loaded = _load_for_documents(*args, **kwargs)
    _route.loaded = len(loaded)
    return loaded


digest_store.load_for_documents = _recording_load

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
    # 検証環境と同じ形のキーとジョブ ID。前読みもジョブごとのキーに置く
    job_id = f"eval-{case['id']}-{uuid.uuid4().hex[:8]}"
    keys = [f"review/original/{case['id']}/{name}" for name in case["files"]]
    _route.loaded = 0
    stored = 0
    try:
        # 検証環境と同じく、前読みが要る書類（長い・スキャン）は先に読み取る。
        # 見るべき観点は、検証環境ではジョブの項目名。ここでは項目1つ
        digests = predigest(paths, [case["check"]["name"]]) if use_predigest else {}
        for key, path in zip(keys, paths):
            _local_s3.put_file(key, path)
            if path in digests:
                read = digests[path]
                _local_s3.put_object_text(
                    digest_store.key_for(key, job_id), to_json(read.pages, read.images)
                )
                stored += 1
        result = agent.process_review(
            document_bucket=BUCKET,
            document_paths=keys,
            check_name=case["check"]["name"],
            check_description=case["check"]["description"],
            language_name="日本語",
            model_id=model_id,
            review_job_id=job_id,
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
        # 前読みを置いたのに、審査が読み込まなかった（受け渡しの漏れなど）
        "readAheadUnused": stored > 0 and getattr(_route, "loaded", 0) < stored,
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
