#!/usr/bin/env python3
"""先に読み取っておく仕組みの、決まりごとのテスト。"""

import os
import sys

import pytest
from pypdf import PdfWriter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from document_digest import (  # noqa: E402
    DigestBatch,
    PageDigest,
    PageSurvey,
    figure_pages,
    from_json,
    merge_batches,
    needs_digest,
    plan_batches,
    survey_pdf,
    to_json,
    unread_pages,
)

LIMITS = {"page_limit": 100, "byte_limit": 4_500_000}


def text_pages(count, characters=2000):
    return [PageSurvey(page=n, characters=characters) for n in range(1, count + 1)]


class TestNeedsDigest:
    def test_leaves_a_small_readable_pdf_alone(self):
        """1回で渡せて文字も取れるなら、費用をかけて読み取らない"""
        assert not needs_digest(text_pages(10), size_bytes=1_000_000, **LIMITS)

    def test_reads_a_pdf_with_too_many_pages(self):
        assert needs_digest(text_pages(101), size_bytes=1_000_000, **LIMITS)

    def test_reads_a_pdf_that_is_too_large(self):
        assert needs_digest(text_pages(10), size_bytes=5_000_000, **LIMITS)

    def test_reads_a_pdf_with_a_page_whose_text_cannot_be_taken_out(self):
        """スキャンした1ページが混ざっているだけでも読み取る。
        そのページは、いまのままだと中身が分からない"""
        pages = text_pages(10) + [PageSurvey(page=11, characters=3)]
        assert needs_digest(pages, size_bytes=1_000_000, **LIMITS)

    def test_says_no_for_a_file_with_no_pages(self):
        assert not needs_digest([], size_bytes=0, **LIMITS)


class TestPlanBatches:
    def test_splits_into_runs_that_fit_one_call(self):
        assert plan_batches(45, batch_size=20) == [
            DigestBatch(1, 20),
            DigestBatch(21, 40),
            DigestBatch(41, 45),
        ]

    def test_keeps_a_single_page_as_its_own_run(self):
        """詰め直すと、どのページがどの呼び出しに入ったか追えなくなる"""
        assert plan_batches(21, batch_size=20) == [
            DigestBatch(1, 20),
            DigestBatch(21, 21),
        ]

    def test_handles_a_document_that_fits_in_one_run(self):
        assert plan_batches(5, batch_size=20) == [DigestBatch(1, 5)]

    def test_has_nothing_to_do_for_an_empty_document(self):
        assert plan_batches(0) == []

    def test_refuses_a_batch_size_that_cannot_advance(self):
        with pytest.raises(ValueError):
            plan_batches(10, batch_size=0)


class TestMergeBatches:
    def test_puts_the_runs_back_in_page_order(self):
        merged = merge_batches(
            [
                [PageDigest(page=3, text="three")],
                [PageDigest(page=1, text="one")],
            ],
            page_count=3,
        )
        assert [d.text for d in merged] == ["one", "", "three"]

    # 抜けたページを詰めると、「12ページ」と言われたものが別のページを指す
    def test_keeps_a_gap_where_a_page_could_not_be_read(self):
        merged = merge_batches([[PageDigest(page=2, text="two")]], page_count=3)
        assert [d.page for d in merged] == [1, 2, 3]
        assert merged[0].text == ""

    def test_ignores_a_page_the_document_does_not_have(self):
        """モデルの返事をそのまま信用しない"""
        merged = merge_batches([[PageDigest(page=99, text="nowhere")]], page_count=2)
        assert all(d.text == "" for d in merged)

    def test_keeps_the_first_answer_when_a_page_comes_back_twice(self):
        merged = merge_batches(
            [
                [PageDigest(page=1, text="first")],
                [PageDigest(page=1, text="second")],
            ],
            page_count=1,
        )
        assert merged[0].text == "first"


class TestReporting:
    def test_names_the_pages_that_were_never_read(self):
        digests = [
            PageDigest(page=1, text="read"),
            PageDigest(page=2),
            PageDigest(page=3, figures=["配置図"]),
        ]
        assert unread_pages(digests) == [2]

    def test_lists_where_the_figures_are(self):
        digests = [
            PageDigest(page=1, text="text only"),
            PageDigest(page=2, text="", figures=["配置図", "断面図"]),
        ]
        assert figure_pages(digests) == [
            {"page": 2, "figures": ["配置図", "断面図"]}
        ]


class TestStoring:
    def test_survives_a_round_trip(self):
        digests = [
            PageDigest(page=1, text="一ページ目", figures=[]),
            PageDigest(page=2, text="", figures=["配置図"]),
        ]
        restored = from_json(to_json(digests))
        assert [(d.page, d.text, d.figures) for d in restored] == [
            (1, "一ページ目", []),
            (2, "", ["配置図"]),
        ]

    # 読み取りは補助。読めないことで審査を止めない
    def test_returns_nothing_when_the_stored_file_is_broken(self):
        assert from_json("{not json") == []

    def test_skips_a_page_that_does_not_make_sense(self):
        payload = '{"pages": [{"text": "no page number"}, {"page": 2, "text": "ok"}]}'
        assert [d.page for d in from_json(payload)] == [2]


SAMPLE_PDF = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "office_planning.pdf"
)


class TestSurveyPdf:
    def test_counts_the_text_on_each_page(self):
        survey = survey_pdf(SAMPLE_PDF)
        assert len(survey) == 2
        assert all(page.characters > 0 for page in survey)
        assert not any(page.looks_scanned for page in survey)

    # 文字の取れないページ。スキャンした書類はこう見える
    def test_spots_a_page_whose_text_cannot_be_taken_out(self, tmp_path):
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        path = tmp_path / "scan.pdf"
        with open(path, "wb") as handle:
            writer.write(handle)

        survey = survey_pdf(str(path))
        assert [page.looks_scanned for page in survey] == [True]

    # 下見のせいで審査を止めない
    def test_says_nothing_about_a_file_it_cannot_open(self, tmp_path):
        broken = tmp_path / "broken.pdf"
        broken.write_bytes(b"not a pdf at all")
        assert survey_pdf(str(broken)) == []

    def test_says_nothing_about_a_file_that_is_not_there(self):
        assert survey_pdf("/no/such/file.pdf") == []
