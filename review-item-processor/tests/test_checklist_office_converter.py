"""チェックリスト取り込み用の Office 変換"""

from __future__ import annotations

import os
from unittest import mock

# boto3 のクライアントは読み込み時に作られるので、先に差し替える
with mock.patch("boto3.client"):
    import checklist_office_converter as converter


def test_splits_a_workbook_at_each_sheet():
    markdown = "# book.xlsx\n\n## Sheet: 一覧\n| A |\n\n## Sheet: 備考\n| B |"

    pages = converter.split_into_pages(markdown)

    assert len(pages) == 2
    assert "## Sheet: 一覧" in pages[0]
    assert "## Sheet: 備考" in pages[1]
    # シートの中身が別のページに混ざらない
    assert "| B |" not in pages[0]
    # どのページを読んでも、どのファイルの話か分かる
    assert all(page.startswith("# book.xlsx") for page in pages)


def test_splits_slides_the_same_way():
    markdown = "## Slide 1: 表紙\n本文\n\n## Slide 2\n本文"

    pages = converter.split_into_pages(markdown)

    assert len(pages) == 2


def test_keeps_a_document_without_headings_in_one_page():
    markdown = "# memo.docx\n\n本文がいくつか\nあるだけの文書"

    assert converter.split_into_pages(markdown) == [markdown]


def test_splits_a_sheet_that_is_too_long_at_line_ends():
    row = "| " + "あ" * 100 + " |"
    rows = [row] * 1000
    markdown = "## Sheet: 長い\n" + "\n".join(rows)

    pages = converter.split_into_pages(markdown)

    assert len(pages) > 1
    assert all(len(page) <= converter.MAX_PAGE_CHARS for page in pages)
    # 行の途中では切らない
    assert all(
        line == "" or line.startswith(("|", "##"))
        for page in pages
        for line in page.split("\n")
    )
    # 分けても行は1つも失わない
    assert sum(page.count(row) for page in pages) == 1000


def test_returns_one_page_even_for_an_empty_file():
    assert converter.split_into_pages("") == [""]


def test_page_keys_match_the_workflow():
    assert converter._page_key("doc-1", 2) == "checklist/pages/doc-1/page_2.md"
    assert (
        converter._original_key("doc-1", "表.xlsx")
        == "checklist/original/doc-1/表.xlsx"
    )


def test_converts_a_real_workbook_end_to_end(tmp_path, monkeypatch):
    """実際の xlsx を通して、変換・分割・S3 への書き込みまでを見る"""
    from tests.test_office_documents import workbook_parts, write_package

    monkeypatch.setenv("DOCUMENT_BUCKET", "bucket")

    path = write_package(tmp_path, "見積.xlsx", workbook_parts())
    written: dict[str, bytes] = {}

    def download_file(_bucket, _key, destination):
        with open(path, "rb") as source, open(destination, "wb") as target:
            target.write(source.read())

    def put_object(*, Bucket, Key, Body, ContentType):  # noqa: N803
        written[Key] = Body

    # バケット名は handler の中で読むので、呼ぶ前に入れておく
    with (
        mock.patch.dict(os.environ, {"DOCUMENT_BUCKET": "documents"}),
        mock.patch.object(converter, "_s3") as s3,
    ):
        s3.download_file.side_effect = download_file
        s3.put_object.side_effect = put_object
        result = converter.handler(
            {"documentId": "doc-1", "fileName": "見積.xlsx"}
        )

    assert result["pageFormat"] == "md"
    assert result["pageCount"] >= 1
    # 返したページ数と、実際に書いた数が合っている
    assert result["pageCount"] == len(written)
    assert result["pages"][0] == {"pageNumber": 1}

    first = written["checklist/pages/doc-1/page_1.md"].decode("utf-8")
    # ファイル名と、シートの見出しが入っている
    assert "見積.xlsx" in first
    assert "## Sheet:" in first
    # 表の値が、画像を経ずにテキストとして残っている
    assert "品目" in first and "保守" in first
    # 表示の書式（¥とカンマ）と、数式が計算した値の両方が残る
    assert "¥30,000" in first
    assert "33000" in first
    # 数式そのものも落ちない。値だけになると、根拠を問われたときに答えられない
    assert "=C{r}*1.1" in first
    # 非表示の行・列・結合も、見落としの原因になるので伝わる
    assert "(hidden)" in first and "[merged cells]" in first
