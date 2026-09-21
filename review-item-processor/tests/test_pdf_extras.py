#!/usr/bin/env python3
"""PDF の、本文として取り出せない中身を読めているかのテスト。

記入済みの申込書を「空の申込書」として審査するのが、いちばん危ない。
"""

import io
import os
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.annotations import FreeText
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    TextStringObject,
)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pdf_extras import (  # noqa: E402
    describe_extras,
    field_values,
    has_hidden_content,
    looks_garbled,
    page_notes,
)


def form_pdf(path, name="申込者氏名", value="山田 太郎"):
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=300)
    field = DictionaryObject()
    field.update(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/FT"): NameObject("/Tx"),
            NameObject("/T"): TextStringObject(name),
            NameObject("/V"): TextStringObject(value),
            NameObject("/Rect"): ArrayObject(
                [FloatObject(x) for x in (50, 200, 250, 230)]
            ),
        }
    )
    reference = writer._add_object(field)
    writer.pages[0][NameObject("/Annots")] = ArrayObject([reference])
    writer._root_object[NameObject("/AcroForm")] = DictionaryObject(
        {NameObject("/Fields"): ArrayObject([reference])}
    )
    with open(path, "wb") as handle:
        writer.write(handle)
    return str(path)


def annotated_pdf(path, text="要確認：金額が相違"):
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=300)
    writer.add_annotation(
        page_number=0, annotation=FreeText(text=text, rect=(50, 50, 250, 100))
    )
    with open(path, "wb") as handle:
        writer.write(handle)
    return str(path)


class TestFormValues:
    # extract_text は空を返す。記入内容はここにしかない
    def test_reads_what_was_filled_into_the_form(self, tmp_path):
        path = form_pdf(tmp_path / "form.pdf")
        reader = PdfReader(path)
        assert reader.pages[0].extract_text().strip() == ""
        assert field_values(reader) == {"申込者氏名": "山田 太郎"}

    def test_leaves_out_an_empty_field(self, tmp_path):
        path = form_pdf(tmp_path / "blank.pdf", value="")
        assert field_values(PdfReader(path)) == {}

    def test_says_nothing_for_a_pdf_with_no_form(self, tmp_path):
        path = annotated_pdf(tmp_path / "plain.pdf")
        assert field_values(PdfReader(path)) == {}


class TestPageNotes:
    # 付箋のコメントは、ページを画像にしても写らない
    def test_reads_a_note_left_on_the_page(self, tmp_path):
        path = annotated_pdf(tmp_path / "note.pdf")
        notes = page_notes(PdfReader(path).pages[0])
        assert any("要確認：金額が相違" in note for note in notes)

    def test_reads_the_value_of_a_form_widget(self, tmp_path):
        path = form_pdf(tmp_path / "form.pdf")
        notes = page_notes(PdfReader(path).pages[0])
        assert notes == ["申込者氏名: 山田 太郎"]

    def test_says_nothing_for_a_page_with_no_notes(self, tmp_path):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        path = tmp_path / "bare.pdf"
        with open(path, "wb") as handle:
            writer.write(handle)
        assert page_notes(PdfReader(str(path)).pages[0]) == []


class TestHasHiddenContent:
    # そのまま渡す経路に載せると、記入内容が読まれるか分からない
    def test_spots_a_filled_in_form(self, tmp_path):
        assert has_hidden_content(form_pdf(tmp_path / "form.pdf"))

    def test_spots_a_pdf_with_notes(self, tmp_path):
        assert has_hidden_content(annotated_pdf(tmp_path / "note.pdf"))

    def test_leaves_an_ordinary_pdf_alone(self, tmp_path):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        path = tmp_path / "plain.pdf"
        with open(path, "wb") as handle:
            writer.write(handle)
        assert not has_hidden_content(str(path))

    # 下見のせいで審査を止めない
    def test_says_no_for_a_file_it_cannot_read(self, tmp_path):
        broken = tmp_path / "broken.pdf"
        broken.write_bytes(b"not a pdf")
        assert not has_hidden_content(str(broken))


class TestLooksGarbled:
    def test_accepts_ordinary_japanese(self):
        assert not looks_garbled("これは普通の日本語の文章です。金額は100万円。")

    def test_accepts_ordinary_english(self):
        assert not looks_garbled("This is an ordinary sentence in a document.")

    # 文字コード表の無いフォント。文字数はあるので「スキャンではない」と
    # 判定され、画像で見直す道に入らない
    def test_spots_text_mapped_into_the_private_use_area(self):
        assert looks_garbled("".join(chr(0xE000 + n) for n in range(40)))

    def test_spots_replacement_characters(self):
        assert looks_garbled("�" * 30)

    def test_does_not_judge_a_short_string(self):
        """割合が当てにならないので、短い文字列では判定しない"""
        assert not looks_garbled("��")

    def test_tolerates_a_few_odd_characters(self):
        text = "契約金額は1,000,000円とする。" * 3 + "�"
        assert not looks_garbled(text)


class TestDescribeExtras:
    def test_writes_the_filled_values_and_the_notes(self):
        text = describe_extras(["[FreeText] 要確認"], {"氏名": "山田"})
        assert "氏名=山田" in text
        assert "要確認" in text

    def test_says_nothing_when_there_is_nothing(self):
        assert describe_extras([], {}) == ""
