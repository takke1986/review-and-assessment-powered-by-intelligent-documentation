#!/usr/bin/env python3
"""
審査するファイルを Converse API の content ブロックに組み立てるテスト。

Converse API は1回の呼び出しに文書5つ・画像20枚までしか受け付けないが、RAPID は
1ジョブに20ファイルまでアップロードでき、全ファイルを1回の呼び出しで渡す。
"""

import io
import os
import sys

import pytest
from pypdf import PdfReader, PdfWriter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import review_documents as rd
from review_documents import ReviewFile
from tests.test_office_documents import (
    document_parts,
    presentation_parts,
    workbook_parts,
    write_package,
)


def pdf(tmp_path, name, pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    path = tmp_path / name
    with open(path, "wb") as handle:
        writer.write(handle)
    return ReviewFile(path=str(path), name=name)


def documents(blocks):
    return [block["document"] for block in blocks if "document" in block]


def texts(blocks):
    return [block["text"] for block in blocks if "text" in block]


def test_each_file_is_its_own_document_when_they_fit(tmp_path):
    files = [
        pdf(tmp_path, "稟議書.pdf"),
        ReviewFile(write_package(tmp_path, "a.xlsx", workbook_parts()), "見積書.xlsx"),
    ]

    blocks = rd.build_document_blocks(files, citations=True)

    assert [(d["name"], d["format"]) for d in documents(blocks)] == [
        ("document-1", "pdf"),
        # 引用ありのときは txt。Bedrock が md を受け取らないため
        ("document-2", "txt"),
    ]
    labels = texts(blocks)
    assert labels[0] == "Document 1 is the file 稟議書.pdf."
    assert labels[1].startswith(
        "Document 2 is the file 見積書.xlsx, converted from its XML to Markdown."
    )
    # 文字の形式は source.text で渡す
    markdown = documents(blocks)[1]["source"]["text"]
    assert markdown.startswith("# 見積書.xlsx\n")
    assert all(d["citations"] == {"enabled": True} for d in documents(blocks))


def test_label_comes_right_before_its_document(tmp_path):
    files = [pdf(tmp_path, "a.pdf"), pdf(tmp_path, "b.pdf")]

    blocks = rd.build_document_blocks(files, citations=False)

    assert "text" in blocks[0] and "document" in blocks[1]
    assert "text" in blocks[2] and "document" in blocks[3]


def test_office_files_are_joined_into_one_document_when_there_are_too_many(tmp_path):
    files = [pdf(tmp_path, f"{index}.pdf") for index in range(4)] + [
        ReviewFile(write_package(tmp_path, "a.xlsx", workbook_parts()), "見積書.xlsx"),
        ReviewFile(write_package(tmp_path, "b.docx", document_parts()), "稟議書.docx"),
    ]

    blocks = rd.build_document_blocks(files, citations=True)

    assert len(documents(blocks)) == 5
    joined = [d for d in documents(blocks) if d["format"] == "txt"]
    assert len(joined) == 1
    markdown = joined[0]["source"]["text"]
    assert "# 見積書.xlsx" in markdown and "# 稟議書.docx" in markdown
    assert any(
        label.startswith("Document 5 joins these files") for label in texts(blocks)
    )


def test_pdfs_are_joined_when_they_do_not_fit_and_pages_are_mapped_back(tmp_path):
    files = [pdf(tmp_path, f"file{index}.pdf", pages=index + 1) for index in range(7)]

    blocks = rd.build_document_blocks(files, citations=True)

    sent = documents(blocks)
    assert len(sent) <= rd.MAX_DOCUMENTS_PER_REQUEST
    total_pages = sum(
        len(PdfReader(io.BytesIO(d["source"]["bytes"])).pages) for d in sent
    )
    assert total_pages == sum(range(1, 8))
    joined_labels = [
        label for label in texts(blocks) if "joins several PDF files" in label
    ]
    assert joined_labels
    assert (
        "name the original file and give the page number within that file"
        in joined_labels[0]
    )
    # 各ファイルが、どの文書のどのページかが書かれている
    for index in range(7):
        assert any(
            f"file{index}.pdf is pages" in label
            or f"is the file file{index}.pdf." in label
            for label in texts(blocks)
        )


def test_joined_pdfs_keep_the_upload_order(tmp_path, monkeypatch):
    monkeypatch.setattr(rd, "MAX_DOCUMENTS_PER_REQUEST", 1)
    files = [pdf(tmp_path, "first.pdf", pages=1), pdf(tmp_path, "second.pdf", pages=3)]

    blocks = rd.build_document_blocks(files, citations=True)

    assert texts(blocks)[0] == (
        "Document 1 joins several PDF files into one, in this order: first.pdf is pages 1-1 "
        "(its own pages 1-1), second.pdf is pages 2-4 (its own pages 1-3). When you refer to a "
        "page, name the original file and give the page number within that file."
    )


def test_files_that_cannot_fit_are_refused_with_a_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(rd, "MAX_DOCUMENTS_PER_REQUEST", 2)
    monkeypatch.setattr(rd, "PDF_JOIN_TARGET_BYTES", 1)
    files = [pdf(tmp_path, f"{index}.pdf") for index in range(3)]

    with pytest.raises(rd.ReviewDocumentError, match="cannot be sent in one request"):
        rd.build_document_blocks(files, citations=True)


def test_images_beyond_the_request_limit_are_named_instead(tmp_path, monkeypatch):
    monkeypatch.setattr(rd, "MAX_IMAGES_PER_REQUEST", 1)
    files = [
        ReviewFile(
            write_package(tmp_path, "deck.pptx", presentation_parts()), "説明資料.pptx"
        )
    ]

    blocks = rd.build_document_blocks(files, citations=True)

    assert len([block for block in blocks if "image" in block]) == 1
    assert (
        "The next image is image1.png, embedded in the file 説明資料.pptx."
        in texts(blocks)
    )
    assert texts(blocks)[-1] == (
        "These embedded images are not attached, to keep a request within 1 images and "
        f"{rd.MAX_IMAGE_BYTES_PER_REQUEST} bytes of images: image2.png in 説明資料.pptx."
    )


def test_images_beyond_the_size_budget_are_named_instead(tmp_path, monkeypatch):
    monkeypatch.setattr(rd, "MAX_IMAGE_BYTES_PER_REQUEST", 1)
    files = [
        ReviewFile(
            write_package(tmp_path, "deck.pptx", presentation_parts()), "説明資料.pptx"
        )
    ]

    blocks = rd.build_document_blocks(files, citations=True)

    assert not [block for block in blocks if "image" in block]
    assert texts(blocks)[-1].endswith(
        "image1.png in 説明資料.pptx, image2.png in 説明資料.pptx."
    )


def test_unsupported_files_are_refused(tmp_path):
    path = tmp_path / "memo.txt"
    path.write_text("hello")

    with pytest.raises(rd.ReviewDocumentError, match="Unsupported file type: memo.txt"):
        rd.build_document_blocks([ReviewFile(str(path), "memo.txt")], citations=True)


def test_office_files_become_markdown_files_for_the_file_read_tool(tmp_path):
    office = ReviewFile(
        write_package(tmp_path, "b.docx", document_parts()), "稟議書.docx"
    )
    plain = pdf(tmp_path, "a.pdf")
    output = tmp_path / "converted"
    output.mkdir()

    paths = rd.write_office_files_as_markdown([plain, office], str(output))

    assert paths[0] == plain.path
    assert paths[1] == str(output / "office-2.md")
    assert (
        (output / "office-2.md")
        .read_text(encoding="utf-8")
        .startswith("# 稟議書.docx\n")
    )


def test_a_pdf_over_the_document_size_is_too_large_for_one_request(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(rd, "MAX_DOCUMENT_BYTES", 10)
    xlsx = ReviewFile(write_package(tmp_path, "b.xlsx", workbook_parts()), "b.xlsx")

    with pytest.raises(rd.RequestTooLargeError, match="a.pdf") as raised:
        rd.build_document_blocks([pdf(tmp_path, "a.pdf"), xlsx], citations=True)

    # ツールで読む方式が、変換し直さずに使う
    assert raised.value.converted[xlsx.path].markdown.startswith("# b.xlsx")


def test_pdfs_over_the_page_limit_are_too_large_for_one_request(tmp_path, monkeypatch):
    monkeypatch.setattr(rd, "MAX_PDF_PAGES_PER_REQUEST", 2)
    files = [pdf(tmp_path, "a.pdf", pages=2), pdf(tmp_path, "b.pdf")]

    with pytest.raises(rd.RequestTooLargeError, match="3 pages in total"):
        rd.build_document_blocks(files, citations=True)


def test_office_goes_as_txt_when_citations_are_on(tmp_path):
    """引用を有効にすると Bedrock は txt と pdf しか受け取らない。

    md で渡していたため、Word や Excel を含む審査が必ず失敗していた。

      ValidationException: Unsupported document format.
      Only txt and pdf formats are supported when citations are enabled

    中身は Markdown のままで、添える一文がそう伝える。
    """
    files = [
        ReviewFile(write_package(tmp_path, "a.xlsx", workbook_parts()), "見積書.xlsx"),
    ]

    blocks = rd.build_document_blocks(files, citations=True)

    formats = {d["format"] for d in documents(blocks)}
    assert formats == {"txt"}, f"引用ありで受け取れない形式が混ざっている: {formats}"


def test_office_keeps_md_when_citations_are_off(tmp_path):
    """引用が無ければ形式の制限は無いので、md のまま渡して中身を正しく伝える"""
    files = [
        ReviewFile(write_package(tmp_path, "a.xlsx", workbook_parts()), "見積書.xlsx"),
    ]

    blocks = rd.build_document_blocks(files, citations=False)

    assert {d["format"] for d in documents(blocks)} == {"md"}


def test_citations_never_use_a_format_bedrock_refuses(tmp_path):
    """引用ありのとき、txt と pdf 以外が混ざっていないかを一律で見る"""
    files = [
        pdf(tmp_path, "稟議書.pdf"),
        ReviewFile(write_package(tmp_path, "a.xlsx", workbook_parts()), "見積書.xlsx"),
        ReviewFile(write_package(tmp_path, "b.docx", document_parts()), "報告書.docx"),
    ]

    blocks = rd.build_document_blocks(files, citations=True)

    refused = {d["format"] for d in documents(blocks)} - {"txt", "pdf"}
    assert not refused, f"Bedrock が引用ありで受け取らない形式: {sorted(refused)}"


def test_text_formats_go_as_text_not_bytes(tmp_path):
    """文字の形式は source.text で渡す。bytes では Bedrock が断る。

      The document source bytes could not be parsed as the specified format.
      If using a text-based format, try source.text instead of source.bytes.

    PDF は今までどおり bytes。
    """
    files = [
        pdf(tmp_path, "稟議書.pdf"),
        ReviewFile(write_package(tmp_path, "a.xlsx", workbook_parts()), "見積書.xlsx"),
    ]

    blocks = rd.build_document_blocks(files, citations=True)

    for document in documents(blocks):
        source = document["source"]
        if document["format"] == "pdf":
            assert "bytes" in source, "PDF は bytes で渡す"
        else:
            assert "text" in source, (
                f"{document['format']} は文字の形式なので text で渡す必要がある"
            )
