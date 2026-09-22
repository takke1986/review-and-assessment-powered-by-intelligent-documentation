"""本文に出ない中身が、モデルに渡る文字列に入るかを決定論的に確かめる。

## なぜこの形か

以前は「審査の答えに合言葉が出たか」で確かめていた。だが答えを書くのは
モデルなので、通っても配線が正しいとは限らず、落ちても配線が壊れていると
は限らない。切り分けにならない。

確かめるべきは**モデルに渡ったか**で、そこは決定論的に測れる。ここが通れば
配線の責任は果たしている。使うかどうかはモデルの領分。

実際、注釈が読まれない不具合では「答えに出ない」ことしか分からず、原因
（経路が file_read に流れていた）にたどり着くまで遠回りした。
"""

import pytest
from pypdf import PdfReader

import agent
from agent import ROUTE_DOCUMENT_TOOLS, _choose_route
from document_library import DocumentLibrary
from review_documents import ReviewFile

from .test_pdf_extras import annotated_pdf

MODEL_ID = "global.anthropic.claude-sonnet-4-6"
CODE_WORD = "TYUUSYAKU-5512"


@pytest.fixture
def pdf_with_a_note(tmp_path):
    """注釈を持つ PDF。本文には合言葉を書かない"""
    return annotated_pdf(tmp_path / "申込書.pdf", text=f"{CODE_WORD} 要確認")


def test_a_pdf_with_a_note_goes_to_the_document_tools(pdf_with_a_note, monkeypatch):
    """経路の判断は決定論的。同じファイルなら必ず同じ経路になる"""
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", True)

    assert (
        _choose_route([pdf_with_a_note], MODEL_ID, has_images=False)
        == ROUTE_DOCUMENT_TOOLS
    )


def test_the_note_is_in_the_text_handed_to_the_model(pdf_with_a_note):
    """注釈が、道具が返す文字列に入っている。

    本文抽出には出ないので、入っていれば注釈を読めた証拠になる。
    """
    library = DocumentLibrary([ReviewFile(pdf_with_a_note, "申込書.pdf")])

    text = library.pdf_pages_text("申込書.pdf", 1)

    assert CODE_WORD in text, (
        "注釈がモデルに渡る文字列に入っていない。配線が切れている"
    )


def test_the_main_text_alone_does_not_contain_it(pdf_with_a_note):
    """判別材料として成り立っているか（この確認自体が意味を持つか）"""
    body = PdfReader(pdf_with_a_note).pages[0].extract_text() or ""

    assert CODE_WORD not in body, (
        "本文にも出るなら、注釈を読めた証拠にならない"
    )
