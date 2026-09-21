"""先に読み取っておいた結果を S3 に置き、審査のときに読み戻す。

書類ごとに1つ。チェック項目が何個あっても読み取りは1回で、全項目が
同じものを使い回す。再審査で同じ文書を引き継いだときも作り直さない。

元のファイルと同じバケットの、別の接頭辞に置く。キーは元のキーから
決まるので、対応表を持たなくてよい。
"""

from __future__ import annotations

import logging
from typing import Optional

from document_digest import PageDigest, from_json, to_json

logger = logging.getLogger(__name__)

DIGEST_PREFIX = "digest/"


def key_for(document_key: str) -> str:
    """元のファイルのキーから、読み取り結果のキーを決める"""
    return f"{DIGEST_PREFIX}{document_key}.json"


def save(bucket: str, document_key: str, digests: list[PageDigest], s3=None) -> None:
    client = s3 or _client()
    client.put_object(
        Bucket=bucket,
        Key=key_for(document_key),
        Body=to_json(digests).encode("utf-8"),
        ContentType="application/json",
    )
    logger.info(
        "Stored the transcription of %s (%s pages)", document_key, len(digests)
    )


def load(bucket: str, document_key: str, s3=None) -> list[PageDigest]:
    """1件読み戻す。無ければ空。

    読み取りは補助なので、取れなくても審査は続ける。そのかわり審査は
    元のファイルを見に行く（スキャンした書類では画像の枠を使う）
    """
    client = s3 or _client()
    try:
        body = client.get_object(Bucket=bucket, Key=key_for(document_key))["Body"]
    except Exception as error:  # NoSuchKey を含む。読めない理由で分けない
        logger.debug("No transcription for %s: %s", document_key, error)
        return []
    try:
        return from_json(body.read().decode("utf-8"))
    except Exception as error:
        logger.warning("Could not read the transcription of %s: %s", document_key, error)
        return []


def load_for_documents(
    bucket: str, local_paths: dict[str, str], s3=None
) -> dict[str, list[PageDigest]]:
    """{S3 のキー: 手元のファイル} を渡すと、{手元のファイル: 読み取り結果} を返す。

    審査側はファイルを手元に落としてから読むので、手元の名前で引けないと
    使えない。中身の無いものは入れない（呼び出し側が「読み取りなし」と
    判断できるように）
    """
    client = s3 or _client()
    digests: dict[str, list[PageDigest]] = {}
    for document_key, local_path in local_paths.items():
        pages = load(bucket, document_key, s3=client)
        if pages:
            digests[local_path] = pages
    return digests


_cached_client = None


def _client():
    global _cached_client
    if _cached_client is None:
        import boto3

        _cached_client = boto3.client("s3")
    return _cached_client
