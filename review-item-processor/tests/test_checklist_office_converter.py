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


def test_reads_a_utf8_text_file(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCUMENT_BUCKET", "bucket")
    path = tmp_path / "手順.txt"
    path.write_text("確認事項\n1. 署名があること\n", encoding="utf-8")
    written: dict[str, bytes] = {}

    with mock.patch.object(converter, "_s3") as s3:
        s3.download_file.side_effect = lambda _b, _k, dest: open(dest, "wb").write(
            path.read_bytes()
        )
        s3.put_object.side_effect = lambda *, Bucket, Key, Body, ContentType: (
            written.__setitem__(Key, Body)
        )
        result = converter.handler({"documentId": "d", "fileName": "手順.txt"})

    page = written["checklist/pages/d/page_1.md"].decode("utf-8")
    assert result["pageFormat"] == "md"
    assert page.startswith("# 手順.txt")
    assert "署名があること" in page


def test_reads_a_csv_saved_by_excel_in_cp932(tmp_path, monkeypatch):
    """Excel から出した CSV は UTF-8 ではないことが多い"""
    monkeypatch.setenv("DOCUMENT_BUCKET", "bucket")
    path = tmp_path / "一覧.csv"
    path.write_bytes("項目,内容\n署名,代表者印\n".encode("cp932"))
    written: dict[str, bytes] = {}

    with mock.patch.object(converter, "_s3") as s3:
        s3.download_file.side_effect = lambda _b, _k, dest: open(dest, "wb").write(
            path.read_bytes()
        )
        s3.put_object.side_effect = lambda *, Bucket, Key, Body, ContentType: (
            written.__setitem__(Key, Body)
        )
        converter.handler({"documentId": "d", "fileName": "一覧.csv"})

    page = written["checklist/pages/d/page_1.md"].decode("utf-8")
    # 化けずに読めている
    assert "項目,内容" in page
    assert "代表者印" in page


def test_decodes_utf8_before_cp932():
    """
    どちらでも解釈できるバイト列がある。UTF-8 を先に試さないと、
    落ちずに化けたまま通ってしまう
    """
    text = "① 署名"

    assert converter.decode_text(text.encode("utf-8"), "a.txt") == text


def test_reads_a_file_saved_as_unicode_by_notepad():
    """メモ帳の「Unicode」は UTF-16。CP932 でも例外は出ないので化けやすい"""
    text = "確認事項"

    assert converter.decode_text(b"\xff\xfe" + text.encode("utf-16-le"), "a.txt") == (
        text
    )


def test_says_so_when_the_bytes_are_not_text():
    import pytest

    # CP932 は例外を出さずに読んでしまうが、NUL が混じるので気づける
    with pytest.raises(RuntimeError, match="could not be read as text"):
        converter.decode_text(b"\x89PNG\r\n\x1a\n\x00\x00\x00", "a.png")


def test_cannot_tell_bom_less_utf16_kanji_apart(tmp_path):
    """
    見抜けない場合の記録。印の無い UTF-16 で中身が漢字だけだと NUL が
    出ないので、CP932 として化けたまま通る。直したらこのテストが落ちる
    """
    decoded = converter.decode_text("確認".encode("utf-16-le"), "a.txt")

    assert decoded != "確認"


def test_refuses_a_file_it_cannot_read(tmp_path, monkeypatch):
    import pytest

    monkeypatch.setenv("DOCUMENT_BUCKET", "bucket")
    path = tmp_path / "図.png"
    path.write_bytes(b"\x89PNG\r\n")

    with mock.patch.object(converter, "_s3") as s3:
        s3.download_file.side_effect = lambda _b, _k, dest: open(dest, "wb").write(
            path.read_bytes()
        )
        with pytest.raises(RuntimeError, match="not a file this step can read"):
            converter.handler({"documentId": "d", "fileName": "図.png"})
