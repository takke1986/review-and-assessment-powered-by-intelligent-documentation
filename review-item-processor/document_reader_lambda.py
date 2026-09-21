"""審査の前に書類を読み取る Lambda。Step Functions から3つの役で呼ばれる。

    plan  → 何をどこまで読むかを決める（モデルを呼ばない。一瞬で終わる）
    read  → 区切った範囲をモデルに読ませ、結果を S3 に置く
    store → 置いた結果をまとめ、書類ごとの読み取り結果にする

## なぜ3つに分けるか

1回の呼び出しに渡せるページ数と画像の枚数には、引き上げられない上限が
ある。区切れば区切った回数だけ読めるので、区切りを Step Functions の Map に
任せて並べて走らせる。

途中の結果を戻り値で持ち回らないのは、Step Functions の状態に載せられる
大きさ（256KB）を超えるため。20ページ分の書き起こしだけで数十KB になり、
書類が大きいほど確実に溢れる。溢れると審査ごと落ちるので、中身は S3 に
置き、状態には置き場所だけを載せる。

## 何もしないことも多い

1回で渡せて文字も取れる書類には、読み取りを回さない。plan が空を返し、
Map は0回、store は何もしない。普段の審査に費用も時間も足さない。
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import uuid
from typing import Any

import boto3

from document_digest import (
    ImageDigest,
    PageDigest,
    merge_batches,
    needs_digest,
    needs_image_digest,
    plan_batches,
    survey_pdf,
    DigestBatch,
)
from document_reader import (
    build_image_content,
    build_image_file_content,
    build_read_content,
    parse_image_descriptions,
    parse_image_file,
    parse_pages,
)
from pdf_extras import has_hidden_content

import digest_store

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

MODEL_ID = os.environ.get("DOCUMENT_MODEL_ID", "global.anthropic.claude-sonnet-4-6")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", os.environ.get("AWS_REGION"))
# 1回の呼び出しに渡せる画像は20枚まで
IMAGES_PER_CALL = 20
PARTIAL_PREFIX = "digest/partials/"
# 審査に上げられる画像。review_documents と同じ並び
IMAGE_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff",
)

# そのまま渡せる書類の目安。review_documents の上限と同じにしてある
PAGE_LIMIT = 100
BYTE_LIMIT = 4_500_000
DOCUMENTS_PER_REQUEST = 5

_s3 = None
_bedrock = None


def s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
    return _bedrock


def handler(event: dict[str, Any], _context: Any = None) -> dict[str, Any]:
    action = event.get("action")
    if action == "plan":
        return plan(event)
    if action == "read":
        return read(event)
    if action == "store":
        return store(event)
    raise ValueError(f"Unknown action: {action}")


# --- 何を読むか決める ------------------------------------------------------


def plan(event: dict[str, Any]) -> dict[str, Any]:
    bucket = event["bucket"]
    tasks: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []
    pictures: list[dict[str, Any]] = []
    # 1回で渡せるかを、ジョブ全体で見るための材料
    facts: list[dict[str, Any]] = []

    for document in event.get("documents") or []:
        # 審査の準備処理は s3Path という名前で渡してくる。呼び出し側に
        # 合わせて詰め替えると、どちらが本物か分からなくなるので両方受ける
        key = document.get("key") or document.get("s3Path")
        if not key:
            continue
        name = document.get("filename") or os.path.basename(key)
        lowered = name.lower()

        if lowered.endswith(".pdf"):
            tasks_for, page_count, fact = _plan_pdf(bucket, key, name)
            facts.append(fact)
        elif lowered.endswith((".docx", ".xlsx", ".pptx")):
            tasks_for, page_count = _plan_office(bucket, key, name)
            facts.append({"kind": "office"})
        elif lowered.endswith(IMAGE_EXTENSIONS):
            # 画像は、ほかの書類の都合で道具経路に回るときだけ読む。下で判断する
            pictures.append({"key": key, "name": name})
            continue
        else:
            continue

        if tasks_for:
            tasks += tasks_for
            documents.append({"key": key, "name": name, "pageCount": page_count})

    # 道具で読む経路に入るジョブでは、画像ファイルはそのままでは読めない
    # （道具が PDF と Office しか扱えない）。そこに写真や図が混ざっていると、
    # 中身が一切見られないまま判定される。先に読んでおけば、文字は画像の枠を
    # 使わずに読め、見る必要があるときだけ開ける。
    #
    # ほかの書類が1回で渡せるジョブでは、画像はそのままモデルに届くので読まない。
    #
    # 「道具経路に入るか」は、書類1件ずつでは決まらない。ページ数の上限は
    # ジョブ全体の合計で効くので、40ページの PDF が3件あれば、どれも単体では
    # 収まるのにジョブは収まらない
    if (bool(tasks) or uses_tools(facts)) and pictures:
        for picture in pictures:
            tasks.append(
                {"kind": "picture", "key": picture["key"], "name": picture["name"]}
            )
            documents.append({**picture, "pageCount": 0})

    logger.info("Planned %s reads across %s documents", len(tasks), len(documents))
    return {"tasks": tasks, "documents": documents, "anyToRead": bool(tasks)}


def _plan_pdf(bucket: str, key: str, name: str) -> tuple[list[dict], int, dict]:
    with _downloaded(bucket, key, ".pdf") as path:
        survey = survey_pdf(path)
        size = os.path.getsize(path)
        hidden = has_hidden_content(path)

    fact = {
        "kind": "pdf",
        "pages": len(survey),
        "bytes": size,
        # 記入値や注釈のある PDF は、そのまま渡す経路に載せない決まりなので、
        # そのジョブは道具で読むことになる
        "hidden": hidden,
    }

    if not survey:
        return ([], 0, fact)
    if not needs_digest(
        survey, size_bytes=size, page_limit=PAGE_LIMIT, byte_limit=BYTE_LIMIT
    ):
        logger.info("%s can be sent as it is, so it is not read ahead", name)
        return ([], 0, fact)

    batches = plan_batches(len(survey))
    return (
        [
            {
                "kind": "pages",
                "key": key,
                "name": name,
                "first": batch.first_page,
                "last": batch.last_page,
            }
            for batch in batches
        ],
        len(survey),
        fact,
    )


def uses_tools(facts: list[dict[str, Any]]) -> bool:
    """このジョブは道具で読む経路に入るか。

    review_documents の上限と同じ見方をする。ずれると、道具で読むのに
    画像を読んでいない（＝写真が見えない）ジョブが生まれる
    """
    pdfs = [fact for fact in facts if fact.get("kind") == "pdf"]
    if any(fact.get("hidden") for fact in pdfs):
        return True
    if any(fact.get("bytes", 0) > BYTE_LIMIT for fact in pdfs):
        return True
    # ページ数はジョブ全体の合計で効く
    if sum(fact.get("pages", 0) for fact in pdfs) > PAGE_LIMIT:
        return True
    # 1回に載せられる文書は5つまで。まとめれば収まることもあるが、
    # ここは多めに見ておく（読みすぎても、画像1枚あたり数円で済む）
    return len(facts) > DOCUMENTS_PER_REQUEST


def _plan_office(bucket: str, key: str, name: str) -> tuple[list[dict], int]:
    """Office は文字を XML からそのまま取れるので、読むのは埋め込み画像だけ"""
    from office_documents import convert_office_file

    with _downloaded(bucket, key, os.path.splitext(name)[1]) as path:
        try:
            document = convert_office_file(path, display_name=name)
        except Exception as error:
            logger.warning("%s could not be converted: %s", name, error)
            return ([], 0)
        count = len(document.images)

    if not needs_image_digest(count):
        return ([], 0)
    return (
        [
            {
                "kind": "images",
                "key": key,
                "name": name,
                "offset": offset,
                "count": min(IMAGES_PER_CALL, count - offset),
            }
            for offset in range(0, count, IMAGES_PER_CALL)
        ],
        0,
    )


# --- 読む ------------------------------------------------------------------


def read(event: dict[str, Any]) -> dict[str, Any]:
    bucket = event["bucket"]
    task = event["task"]
    key, name = task["key"], task["name"]

    if task["kind"] == "pages":
        batch = DigestBatch(task["first"], task["last"])
        with _downloaded(bucket, key, ".pdf") as path:
            content = build_read_content(path=path, name=name, batch=batch)
        if not content:
            return _partial(bucket, key, {"pages": []})
        reply = _ask(content)
        pages = parse_pages(reply, batch)
        logger.info("Read pages %s-%s of %s", batch.first_page, batch.last_page, name)
        return _partial(
            bucket,
            key,
            {
                "pages": [
                    {"page": p.page, "text": p.text, "figures": p.figures}
                    for p in pages
                ]
            },
        )

    if task["kind"] == "picture":
        with _downloaded(bucket, key, os.path.splitext(name)[1]) as path:
            content = build_image_file_content(path=path, name=name)
        if not content:
            return _partial(bucket, key, {"images": []})
        read_picture = parse_image_file(_ask(content), name)
        logger.info("Read the picture %s", name)
        return _partial(
            bucket,
            key,
            {
                "images": [
                    {
                        "name": read_picture.name,
                        "description": read_picture.description,
                        "text": read_picture.text,
                    }
                ]
                if read_picture
                else []
            },
        )

    from office_documents import convert_office_file

    with _downloaded(bucket, key, os.path.splitext(name)[1]) as path:
        document = convert_office_file(path, display_name=name)
    chosen = document.images[task["offset"] : task["offset"] + task["count"]]
    content = build_image_content(chosen, name=name)
    if not content:
        return _partial(bucket, key, {"images": []})
    reply = _ask(content)
    described = parse_image_descriptions(reply, [image.name for image in chosen])
    logger.info("Described %s pictures in %s", len(described), name)
    return _partial(
        bucket,
        key,
        {"images": [{"name": i.name, "description": i.description} for i in described]},
    )


def _ask(content: list[dict[str, Any]]) -> str:
    response = bedrock().converse(
        modelId=MODEL_ID,
        messages=[{"role": "user", "content": content}],
        inferenceConfig={"maxTokens": 8000, "temperature": 0},
    )
    usage = response.get("usage") or {}
    logger.info(
        "Bedrock usage: input=%s output=%s cache_read=%s cache_write=%s",
        usage.get("inputTokens"),
        usage.get("outputTokens"),
        usage.get("cacheReadInputTokens"),
        usage.get("cacheWriteInputTokens"),
    )
    return "".join(
        block.get("text", "") for block in response["output"]["message"]["content"]
    )


def _partial(bucket: str, key: str, payload: dict[str, Any]) -> dict[str, Any]:
    """途中の結果を S3 に置き、置き場所だけを返す。

    Step Functions の状態に載せると 256KB を超えて審査ごと落ちる
    """
    name = f"{PARTIAL_PREFIX}{key}/{uuid.uuid4().hex}.json"
    s3().put_object(
        Bucket=bucket,
        Key=name,
        Body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    return {"key": key, "partial": name}


# --- まとめる --------------------------------------------------------------


def store(event: dict[str, Any]) -> dict[str, Any]:
    bucket = event["bucket"]
    partials = event.get("partials") or []
    by_document: dict[str, list[dict[str, Any]]] = {}
    for entry in partials:
        if not entry:
            continue
        by_document.setdefault(entry["key"], []).append(entry)

    page_counts = {
        document["key"]: document.get("pageCount") or 0
        for document in event.get("documents") or []
    }

    stored = 0
    for key, entries in by_document.items():
        pages_batches: list[list[PageDigest]] = []
        images: list[ImageDigest] = []
        for entry in entries:
            payload = _read_partial(bucket, entry["partial"])
            pages_batches.append(
                [
                    PageDigest(
                        page=int(p["page"]),
                        text=p.get("text") or "",
                        figures=list(p.get("figures") or []),
                    )
                    for p in payload.get("pages") or []
                ]
            )
            images += [
                ImageDigest(
                    name=i["name"],
                    description=i.get("description") or "",
                    text=i.get("text") or "",
                )
                for i in payload.get("images") or []
            ]

        pages = merge_batches(pages_batches, page_count=page_counts.get(key, 0))
        digest_store.save(bucket, key, pages=pages, images=images, s3=s3())
        stored += 1
        _forget_partials(bucket, entries)

    logger.info("Stored what was read from %s documents", stored)
    return {"stored": stored}


def _read_partial(bucket: str, key: str) -> dict[str, Any]:
    try:
        body = s3().get_object(Bucket=bucket, Key=key)["Body"].read()
        return json.loads(body.decode("utf-8"))
    except Exception as error:
        # 1つ読めなくても、読めた分はまとめる。そのページは「読めなかった
        # ページ」として残り、審査は元のファイルを見に行く
        logger.warning("Could not read the partial %s: %s", key, error)
        return {}


def _forget_partials(bucket: str, entries: list[dict[str, Any]]) -> None:
    for entry in entries:
        try:
            s3().delete_object(Bucket=bucket, Key=entry["partial"])
        except Exception as error:
            logger.debug("Could not remove the partial: %s", error)


# --- 補助 ------------------------------------------------------------------


class _downloaded:
    """S3 のファイルを手元に落とす。使い終わったら消す"""

    def __init__(self, bucket: str, key: str, suffix: str):
        self._bucket, self._key, self._suffix = bucket, key, suffix or ""

    def __enter__(self) -> str:
        handle = tempfile.NamedTemporaryFile(suffix=self._suffix, delete=False)
        handle.close()
        self._path = handle.name
        s3().download_file(self._bucket, self._key, self._path)
        return self._path

    def __exit__(self, *_args) -> None:
        try:
            os.remove(self._path)
        except OSError:
            pass
