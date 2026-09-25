"""先に読み取っておいた結果を S3 に置き、審査のときに読み戻す。

審査ジョブごと・書類ごとに1つ。チェック項目が何個あっても読み取りは
1回で、そのジョブの全項目が同じものを使い回す。

ジョブをまたいでは使い回さない。読み取りはそのジョブのチェックリストを
踏まえて書くので、別のチェックリストの審査に持ち越すと、見るべき観点が
ずれたものを根拠にすることになる。書類が差し替わっていないかも、ここでは
分からない。読み直す費用より、古いものを黙って使う危うさのほうが高い。

元のファイルと同じバケットの、別の接頭辞に置く。キーはジョブと元のキーから
決まるので、対応表を持たなくてよい。
"""

from __future__ import annotations

import logging
from typing import Optional

from document_digest import DocumentDigest, ImageDigest, PageDigest, from_json, to_json

logger = logging.getLogger(__name__)

DIGEST_PREFIX = "digest/"


def key_for(document_key: str, job_id: str) -> str:
    """ジョブと元のファイルのキーから、読み取り結果のキーを決める"""
    return f"{DIGEST_PREFIX}{job_id}/{document_key}.json"


def save(
    bucket: str,
    document_key: str,
    job_id: str,
    pages: list[PageDigest] | None = None,
    images: list[ImageDigest] | None = None,
    s3=None,
) -> None:
    client = s3 or _client()
    client.put_object(
        Bucket=bucket,
        Key=key_for(document_key, job_id),
        Body=to_json(pages or [], images or []).encode("utf-8"),
        ContentType="application/json",
    )
    logger.info(
        "Stored what was read from %s (%s pages, %s pictures)",
        document_key,
        len(pages or []),
        len(images or []),
    )


def load(bucket: str, document_key: str, job_id: str, s3=None) -> DocumentDigest:
    """1件読み戻す。無ければ空。

    読み取りは補助なので、取れなくても審査は続ける。そのかわり審査は
    元のファイルを見に行く（スキャンした書類では画像の枠を使う）
    """
    client = s3 or _client()
    try:
        body = client.get_object(
            Bucket=bucket, Key=key_for(document_key, job_id)
        )["Body"]
    except Exception as error:  # NoSuchKey を含む。読めない理由で分けない
        logger.debug("Nothing was read ahead for %s: %s", document_key, error)
        return DocumentDigest()
    try:
        return from_json(body.read().decode("utf-8"))
    except Exception as error:
        logger.warning("Could not read what was stored for %s: %s", document_key, error)
        return DocumentDigest()


def load_for_documents(
    bucket: str, local_paths: dict[str, str], job_id: str, s3=None
) -> dict[str, DocumentDigest]:
    """{S3 のキー: 手元のファイル} を渡すと、{手元のファイル: 読み取り結果} を返す。

    審査側はファイルを手元に落としてから読むので、手元の名前で引けないと
    使えない。中身の無いものは入れない（呼び出し側が「読み取りなし」と
    判断できるように）
    """
    if not job_id:
        # 前読みはジョブごとに置いてあるので、ジョブが分からなければ引けない。
        # 読めないこと自体はよくある（前読みしない書類が多い）ので普段は黙るが、
        # ジョブ ID が無いのは呼び出し側の間違いなので知らせる
        logger.warning("No review job id was given, so no read-ahead can be found")
        return {}
    client = s3 or _client()
    digests: dict[str, DocumentDigest] = {}
    for document_key, local_path in local_paths.items():
        digest = load(bucket, document_key, job_id, s3=client)
        if digest:
            digests[local_path] = digest
    return digests


_cached_client = None


def _client():
    global _cached_client
    if _cached_client is None:
        import boto3

        _cached_client = boto3.client("s3")
    return _cached_client
