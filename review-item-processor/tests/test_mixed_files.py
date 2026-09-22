#!/usr/bin/env python3
"""
文書と画像を1つの審査に混ぜたときの扱い。

混在は「壊れてもそれらしい結果が返る」種類の失敗をするので、
届いているか・指示されているか・選ばれる経路が正しいかを別々に確かめる。
"""

import io
import os
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import agent
import review_documents
from review_documents import ReviewFile, build_document_blocks

MODEL_ID = "global.anthropic.claude-sonnet-4-6"


def _write_image(path, size=(40, 30), color=(200, 30, 30)):
    Image.new("RGB", size, color).save(path)
    return str(path)


def _write_pdf(path):
    # 1ページだけの最小の PDF（pypdf で作る）
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with open(path, "wb") as handle:
        writer.write(handle)
    return str(path)


def test_an_uploaded_image_is_attached_with_its_name(tmp_path):
    image = _write_image(tmp_path / "図面.png")
    blocks = build_document_blocks([ReviewFile(image, "図面.png")], citations=False)

    texts = [block["text"] for block in blocks if "text" in block]
    images = [block["image"] for block in blocks if "image" in block]
    assert len(images) == 1
    assert images[0]["format"] in ("png", "jpeg")
    assert any("図面.png" in text for text in texts)


def test_documents_and_images_travel_in_one_request(tmp_path):
    pdf = _write_pdf(tmp_path / "仕様書.pdf")
    image = _write_image(tmp_path / "現場.jpg")
    blocks = build_document_blocks(
        [ReviewFile(pdf, "仕様書.pdf"), ReviewFile(image, "現場.jpg")], citations=False
    )

    assert any("document" in block for block in blocks)
    assert any("image" in block for block in blocks)


def test_images_over_the_limit_are_named_not_attached(tmp_path, monkeypatch):
    monkeypatch.setattr(review_documents, "MAX_IMAGES_PER_REQUEST", 1)
    files = [
        ReviewFile(_write_image(tmp_path / "1枚目.png"), "1枚目.png"),
        ReviewFile(_write_image(tmp_path / "2枚目.png"), "2枚目.png"),
    ]
    blocks = build_document_blocks(files, citations=False)

    assert len([block for block in blocks if "image" in block]) == 1
    left_out = " ".join(block["text"] for block in blocks if "text" in block)
    assert "2枚目.png" in left_out


def test_a_file_that_is_neither_document_nor_image_is_still_rejected(tmp_path):
    other = tmp_path / "memo.txt"
    other.write_text("hello")
    with pytest.raises(review_documents.ReviewDocumentError):
        build_document_blocks([ReviewFile(str(other), "memo.txt")], citations=False)


def test_mixed_files_take_the_document_block_path(tmp_path):
    # 画像だけなら file_read の経路（拡大や切り出しができる）
    assert (
        agent._choose_route(["a.png"], MODEL_ID, has_images=True)
        == agent.ROUTE_FILE_READ
    )
    # 文書と混ざっているなら、両方を1回に載せられる文書ブロックの経路
    assert (
        agent._choose_route(["a.png", "b.pdf"], MODEL_ID, has_images=True)
        == agent.ROUTE_DOCUMENT_BLOCK
    )
    # 文書だけのときの挙動は変えない
    assert (
        agent._choose_route(["b.pdf"], MODEL_ID, has_images=False)
        == agent.ROUTE_DOCUMENT_BLOCK
    )


def test_the_prompt_tells_the_model_to_look_at_the_images():
    prompt = agent.get_document_review_prompt(
        "日本語",
        "名前",
        "説明",
        use_citations=False,
        document_access=agent.ATTACHED_IMAGES_ACCESS,
    )

    assert "images" in prompt
    assert "file_read" not in prompt
