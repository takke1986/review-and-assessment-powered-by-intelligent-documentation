#!/usr/bin/env python3
"""区切ったページを読み取るときの、返事の受け取り方のテスト。"""

import os
import sys

from pypdf import PdfWriter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from document_digest import DigestBatch  # noqa: E402
from document_reader import (  # noqa: E402
    build_read_content,
    build_read_prompt,
    parse_pages,
    render_pages,
)

BATCH = DigestBatch(1, 3)

SAMPLE_PDF = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "office_planning.pdf"
)


class TestParsePages:
    def test_reads_a_plain_json_reply(self):
        reply = '{"pages": [{"page": 1, "text": "一枚目", "figures": []}]}'
        pages = parse_pages(reply, BATCH)
        assert [(p.page, p.text, p.figures) for p in pages] == [(1, "一枚目", [])]

    def test_keeps_what_the_figures_show(self):
        reply = '{"pages": [{"page": 2, "text": "", "figures": ["配置図。北が上"]}]}'
        assert parse_pages(reply, BATCH)[0].figures == ["配置図。北が上"]

    # モデルは説明を添えたり ``` で囲んだりする
    def test_finds_json_wrapped_in_a_code_fence(self):
        reply = 'Here you go:\n```json\n{"pages": [{"page": 1, "text": "ok"}]}\n```'
        assert parse_pages(reply, BATCH)[0].text == "ok"

    def test_finds_json_with_words_around_it(self):
        reply = 'I read the pages. {"pages": [{"page": 1, "text": "ok"}]} Done.'
        assert parse_pages(reply, BATCH)[0].text == "ok"

    # 読んでいないページの中身を、読んだことにしない
    def test_drops_a_page_outside_the_range_that_was_read(self):
        reply = '{"pages": [{"page": 9, "text": "never read"}]}'
        assert parse_pages(reply, BATCH) == []

    def test_drops_an_entry_with_no_page_number(self):
        reply = '{"pages": [{"text": "which page?"}, {"page": 1, "text": "ok"}]}'
        assert [p.page for p in parse_pages(reply, BATCH)] == [1]

    def test_drops_empty_figure_entries(self):
        reply = '{"pages": [{"page": 1, "text": "x", "figures": ["", "  ", "図"]}]}'
        assert parse_pages(reply, BATCH)[0].figures == ["図"]

    def test_survives_figures_that_are_not_a_list(self):
        reply = '{"pages": [{"page": 1, "text": "x", "figures": "配置図"}]}'
        assert parse_pages(reply, BATCH)[0].figures == []

    # 読み取れなければ、呼び出し側が「読めなかったページ」として扱う
    def test_returns_nothing_for_a_reply_that_is_not_json(self):
        assert parse_pages("I could not read these pages.", BATCH) == []

    def test_returns_nothing_for_an_empty_reply(self):
        assert parse_pages("", BATCH) == []

    def test_returns_nothing_when_pages_is_not_a_list(self):
        assert parse_pages('{"pages": "one"}', BATCH) == []


class TestPrompt:
    def test_names_the_pages_and_the_file(self):
        prompt = build_read_prompt(name="申込書.pdf", batch=DigestBatch(21, 40))
        assert "21-40" in prompt
        assert "申込書.pdf" in prompt

    def test_asks_for_the_language_the_review_is_written_in(self):
        assert "Japanese" in build_read_prompt(name="a.pdf", batch=BATCH)
        assert "English" in build_read_prompt(
            name="a.pdf", batch=BATCH, language="English"
        )


class TestRendering:
    def test_draws_each_page_in_the_range(self):
        images = render_pages(SAMPLE_PDF, DigestBatch(1, 2))
        assert [number for number, _, _ in images] == [1, 2]
        assert all(data for _, _, data in images)

    def test_stops_at_the_end_of_the_document(self):
        images = render_pages(SAMPLE_PDF, DigestBatch(1, 20))
        assert [number for number, _, _ in images] == [1, 2]

    # 番号を書かないと、描けなかったページから先がすべてずれる
    def test_puts_the_page_number_before_each_image(self):
        content = build_read_content(
            path=SAMPLE_PDF, name="計画書.pdf", batch=DigestBatch(1, 2)
        )
        assert content[0]["text"] == "Page 1 of 計画書.pdf:"
        assert "image" in content[1]
        assert content[2]["text"] == "Page 2 of 計画書.pdf:"
        assert "image" in content[3]
        assert "transcribing" in content[-1]["text"]

    def test_asks_for_nothing_when_no_page_could_be_drawn(self, tmp_path):
        empty = tmp_path / "empty.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=10, height=10)
        with open(empty, "wb") as handle:
            writer.write(handle)

        assert build_read_content(
            path=str(empty), name="empty.pdf", batch=DigestBatch(5, 6)
        ) == []
