#!/usr/bin/env python3
"""
1回の呼び出しに収まらないジョブで、モデルがツールでファイルを読むための仕組みのテスト。
"""

import io
import os
import sys

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import document_library as dl
from document_library import DocumentLibrary, DocumentToolError, split_sections
from review_documents import ReviewFile
from tests.test_office_documents import workbook_parts, write_package

SAMPLE_PDF = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "office_planning.pdf"
)


def text_pdf(tmp_path, name, copies=1):
    """文字のあるサンプル PDF を copies 回つなげる"""
    writer = PdfWriter()
    for _ in range(copies):
        for page in PdfReader(SAMPLE_PDF).pages:
            writer.add_page(page)
    path = tmp_path / name
    with open(path, "wb") as handle:
        writer.write(handle)
    return ReviewFile(str(path), name)


def blank_pdf(tmp_path, name):
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    path = tmp_path / name
    with open(path, "wb") as handle:
        writer.write(handle)
    return ReviewFile(str(path), name)


def workbook(tmp_path, name="見積.xlsx"):
    return ReviewFile(write_package(tmp_path, "book.xlsx", workbook_parts()), name)


def test_sections_are_split_at_second_level_headings_and_long_ones_into_parts(
    monkeypatch,
):
    monkeypatch.setattr(dl, "SECTION_PART_CHARS", 12)
    sections = split_sections(
        "# book\nlabel\n\n## Sheet: A\n1234\n5678\n90\n## Sheet: B\nx"
    )

    assert [section.heading for section in sections] == [
        "(beginning of the file)",
        "Sheet: A",
        "Sheet: B",
    ]
    assert sections[1].parts == ["## Sheet: A", "1234\n5678", "90"]
    assert sections[2].parts == ["## Sheet: B", "x"]


def test_a_line_longer_than_a_part_is_cut():
    assert dl._split_lines("abcdefg", 3) == ["abc", "def", "g"]


def test_overview_lists_pages_sections_and_duplicate_names(tmp_path):
    first = text_pdf(tmp_path, "a.pdf")
    second = ReviewFile(text_pdf(tmp_path, "b.pdf").path, "a.pdf")
    library = DocumentLibrary([first, second, workbook(tmp_path)])

    files = library.overview()["files"]

    assert [entry["file"] for entry in files] == ["a.pdf", "a.pdf (2)", "見積.xlsx"]
    assert files[0]["pages"] == 2
    assert files[2]["type"] == "excel"
    assert any(
        section["heading"].startswith("Sheet:") for section in files[2]["sections"]
    )


def test_pdf_pages_are_read_with_their_file_and_page(tmp_path):
    library = DocumentLibrary([text_pdf(tmp_path, "計画書.pdf")])

    text = library.pdf_pages_text("計画書.pdf", 1, 2)

    assert "--- 計画書.pdf, page 1 of 2 ---\n小規模オフィス安全管理計画書" in text
    assert "--- 計画書.pdf, page 2 of 2 ---" in text
    assert library.chars_returned == len(text)


def test_at_most_a_set_number_of_pages_are_read_at_a_time(tmp_path, monkeypatch):
    monkeypatch.setattr(dl, "MAX_PAGES_PER_READ", 2)
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf", copies=2)])

    text = library.pdf_pages_text("a.pdf", 1, 4)

    assert "page 2 of 4" in text and "page 3 of 4" not in text
    assert "Pages 3-4 were not returned" in text


def test_pages_without_text_point_to_the_page_image(tmp_path):
    library = DocumentLibrary([blank_pdf(tmp_path, "scan.pdf")])

    assert "use view_pdf_page" in library.pdf_pages_text("scan.pdf", 1)


def test_page_out_of_range_and_unknown_files_explain_what_exists(tmp_path):
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf"), workbook(tmp_path)])

    with pytest.raises(DocumentToolError, match="pages 1-2"):
        library.pdf_pages_text("a.pdf", 3)
    with pytest.raises(DocumentToolError, match="The files are: a.pdf, 見積.xlsx"):
        library.pdf_pages_text("b.pdf", 1)
    with pytest.raises(DocumentToolError, match="not a PDF"):
        library.pdf_pages_text("見積.xlsx", 1)


def test_file_names_match_without_extension_or_width_differences(tmp_path):
    library = DocumentLibrary([text_pdf(tmp_path, "Ｐｌａｎ.pdf")])

    assert "page 1 of 2" in library.pdf_pages_text("plan", 1)


def test_search_finds_pdf_pages_and_office_sections(tmp_path):
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf"), workbook(tmp_path)])

    result = library.search("安全衛生責任者 保守")

    locations = {
        (hit["file"], hit.get("page"), hit.get("section")) for hit in result["hits"]
    }
    assert ("a.pdf", 1, None) in locations
    assert any(file == "見積.xlsx" and section for file, _, section in locations)
    assert all(hit["snippet"] for hit in result["hits"])


def test_search_puts_places_with_more_words_first(tmp_path):
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf")])

    hits = library.search("存在しない語 安全衛生責任者 山田太郎")["hits"]

    assert hits[0]["matchedTerms"] == ["安全衛生責任者", "山田太郎"]


def test_pdf_page_is_drawn_as_an_image_within_the_limits(tmp_path):
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf")])

    image = library.pdf_page_image("a.pdf", 1)

    assert image.format == "jpeg"
    with Image.open(io.BytesIO(image.data)) as drawn:
        assert max(drawn.size) == dl.PAGE_IMAGE_LONG_SIDE
    assert library.images_returned == 1


def test_images_stop_at_the_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(dl, "MAX_IMAGES_PER_REVIEW", 1)
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf")])

    library.pdf_page_image("a.pdf", 1)
    with pytest.raises(DocumentToolError, match="No more images"):
        library.pdf_page_image("a.pdf", 2)


def test_reading_is_cut_off_and_then_refused_when_the_budget_is_used_up(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(dl, "MAX_CHARS_PER_REVIEW", 50)
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf")])

    assert "Cut off here" in library.pdf_pages_text("a.pdf", 1)
    with pytest.raises(DocumentToolError, match="budget"):
        library.pdf_pages_text("a.pdf", 2)


def test_office_sections_are_read_by_number(tmp_path):
    library = DocumentLibrary([workbook(tmp_path)])
    sections = library.overview()["files"][0]["sections"]
    sheet = next(
        section for section in sections if section["heading"].startswith("Sheet:")
    )

    text = library.office_section("見積.xlsx", sheet["section"])

    assert text.startswith(f"--- 見積.xlsx, section {sheet['section']} (Sheet:")
    assert "保守" in text
    with pytest.raises(DocumentToolError, match="sections 1-"):
        library.office_section("見積.xlsx", 99)


def test_already_converted_office_files_are_not_converted_again(tmp_path, monkeypatch):
    from office_documents import OfficeDocument

    file = workbook(tmp_path)
    monkeypatch.setattr(
        dl,
        "convert_office_file",
        lambda *args, **kwargs: pytest.fail("converted again"),
    )
    library = DocumentLibrary(
        [file], converted={file.path: OfficeDocument("# 見積.xlsx\n\n## Sheet: S\nok")}
    )

    assert library.office_section("見積.xlsx", 2).endswith("## Sheet: S\nok")


def test_tools_return_text_json_and_images_to_the_model(tmp_path):
    library = DocumentLibrary([text_pdf(tmp_path, "a.pdf")])
    tools = {tool.tool_name: tool for tool in dl.create_document_tools(library)}

    assert set(tools) == {
        "list_documents",
        "search_documents",
        "read_pdf_pages",
        "view_pdf_page",
        "read_office_section",
        "read_picture",
        "view_embedded_image",
    }
    assert tools["list_documents"]()["content"][0]["json"]["files"][0]["pages"] == 2
    page = tools["view_pdf_page"](file="a.pdf", page=1)
    assert page["status"] == "success"
    assert page["content"][1]["image"]["format"] == "jpeg"
    schema = tools["read_pdf_pages"].tool_spec["inputSchema"]["json"]
    assert schema["required"] == ["file", "first_page"]


def test_search_finds_a_scanned_page_through_its_transcription(tmp_path):
    # 文字の取れないページは、前読みの書き起こしで探す。以前は検索だけ
    # ファイルの文字しか見ず、スキャンした書類では何を探しても0件だった
    from document_digest import DocumentDigest, PageDigest

    file = blank_pdf(tmp_path, "スキャン.pdf")
    digest = DocumentDigest(
        pages=[PageDigest(page=1, text="第9条（反社会的勢力の排除）甲および乙は…")]
    )
    library = DocumentLibrary([file], digests={file.path: digest})

    found = library.search("反社会的勢力")

    assert found["totalMatches"] == 1
    assert found["hits"][0]["page"] == 1


def test_search_does_not_use_a_transcription_for_a_page_with_text(tmp_path):
    # 文字の取れるページはファイルの文字で探す（読む道具と同じ判定）
    from document_digest import DocumentDigest, PageDigest

    file = text_pdf(tmp_path, "本文.pdf")
    digest = DocumentDigest(pages=[PageDigest(page=1, text="書き起こしにだけある語")])
    library = DocumentLibrary([file], digests={file.path: digest})

    assert library.search("書き起こしにだけある語")["totalMatches"] == 0


def test_reading_progress_tells_what_is_left_and_coverage_counts_what_was_returned(
    tmp_path,
):
    # 道具は1回20ページまで。以前はモデルが読み直さずに先へ進み、読んでいない
    # ページまで「全ページを確認した」と書いた。読んだ範囲と残りを毎回見せる
    file = text_pdf(tmp_path, "長い.pdf", copies=13)  # 26ページ
    library = DocumentLibrary([file])

    first = library.pdf_pages_text("長い.pdf", 1, 30)

    assert "read so far: 1-20 of 26" in first
    assert "Not read yet: 21-26" in first
    assert library.coverage() == [
        {"file": "長い.pdf", "unit": "page", "total": 26, "read": 20, "unread": "21-26"}
    ]

    rest = library.pdf_pages_text("長い.pdf", 21, 26)
    assert "You have now read every page of 長い.pdf" in rest
    assert library.coverage()[0]["unread"] == "none"


def test_ranges_are_written_compactly():
    assert dl._ranges([1, 2, 3, 7, 9, 10]) == "1-3, 7, 9-10"
    assert dl._ranges([]) == "none"
