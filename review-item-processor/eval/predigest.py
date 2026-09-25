"""検証環境の前読み（document_reader_lambda）を手元で再現する。

前読みは、1回で渡せない書類（100ページ超・4.5MB 超）とスキャンした書類に
だけ作られる。審査は、前読みがあれば道具で読む経路に入り、文字の取れない
ページは書き起こしに差し替えて読む。評価で前読みを作らないと、スキャンした
書類は検証環境と違う形で審査される。

読み取りの関数は検証環境と同じものを呼ぶ。1回の前読みは書類の大きさに応じて
費用がかかる（120ページで $1〜2）ので、結果は .digest-cache/ に残して使い回す。
書類か見るべき観点が変われば作り直す。
"""

import hashlib
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from document_digest import (
    DocumentDigest,
    from_json,
    merge_batches,
    needs_digest,
    plan_batches,
    survey_pdf,
    to_json,
)
from document_reader import build_read_content, parse_pages
import document_reader_lambda as reader

CACHE = Path(__file__).parent / ".digest-cache"

# ページを画像にするライブラリ（pdfium）はスレッドに対して安全でない。
# 評価はケースもバッチも並列に流すので、画像にするところだけ1つずつにする。
# 並列のままだと「Failed to load document (Data format error)」で落ちた。
# 検証環境はバッチごとに別の Lambda で読むので、この問題は無い
_RENDER_LOCK = threading.Lock()


def _cache_path(path: str, focus: list[str]) -> Path:
    digest = hashlib.sha256(Path(path).read_bytes())
    digest.update(json.dumps(focus, ensure_ascii=False).encode())
    return CACHE / f"{digest.hexdigest()[:24]}.json"


def _read_pdf(path: str, focus: list[str]) -> DocumentDigest | None:
    survey = survey_pdf(path)
    if not survey or not needs_digest(
        survey,
        size_bytes=os.path.getsize(path),
        page_limit=reader.PAGE_LIMIT,
        byte_limit=reader.BYTE_LIMIT,
    ):
        return None

    def read_batch(batch):
        with _RENDER_LOCK:
            content = build_read_content(
                path=path, name=os.path.basename(path), batch=batch, focus=focus
            )
        return parse_pages(reader._ask(content), batch) if content else []

    with ThreadPoolExecutor(max_workers=4) as pool:
        batches = list(pool.map(read_batch, plan_batches(len(survey))))
    return DocumentDigest(pages=merge_batches(batches, page_count=len(survey)))


def predigest(paths: list[str], focus: list[str]) -> dict[str, DocumentDigest]:
    """前読みが要る書類だけ読み取って、{ファイルのパス: 読み取り結果} を返す"""
    digests: dict[str, DocumentDigest] = {}
    for path in paths:
        if not path.lower().endswith(".pdf"):
            continue
        cached = _cache_path(path, focus)
        if cached.exists():
            payload = cached.read_text()
            if payload:
                digests[path] = from_json(payload)
            continue
        read = _read_pdf(path, focus)
        CACHE.mkdir(exist_ok=True)
        cached.write_text(to_json(read.pages, read.images) if read else "")
        if read:
            digests[path] = read
    return digests
