#!/usr/bin/env python3
"""
agent.py が、審査するファイルをモデルにどう渡し、根拠のファイルをどう受け取るかのテスト。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import agent
from review_documents import ReviewFile
from tests.test_office_documents import document_parts, write_package

MODEL_ID = "global.anthropic.claude-sonnet-4-6"


class Sent(Exception):
    """Stops the agent once the request content has been captured."""


def test_document_block_sends_office_files_as_markdown_after_their_names(
    tmp_path, monkeypatch
):
    sent = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            pass

        def __call__(self, content):
            sent["content"] = content
            raise Sent

    monkeypatch.setattr(agent, "Agent", FakeAgent)
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    docx = write_package(tmp_path, "b.docx", document_parts())

    with pytest.raises(Sent):
        agent._run_agent_with_document_block(
            "prompt",
            [ReviewFile(str(pdf), "稟議書.pdf"), ReviewFile(docx, "申請書.docx")],
            MODEL_ID,
        )

    content = sent["content"]
    assert content[0] == {"text": "Document 1 is the file 稟議書.pdf."}
    # 引用に対応したモデルでは citations=True になり、Bedrock は txt と pdf しか
    # 受け取らない。md を渡していたため Word や Excel の審査が必ず失敗していた
    assert [
        block["document"]["format"] for block in content if "document" in block
    ] == ["pdf", "txt"]
    assert any("image" in block for block in content)
    assert content[-1] == {"text": "prompt"}


def test_file_read_tool_reads_office_files_as_markdown(tmp_path, monkeypatch):
    seen = {}

    def fake_file_read_agent(prompt, files, **kwargs):
        # 変換したファイルは審査が終わると消えるので、ここで読む
        seen["files"] = [
            (file.path, file.name, open(file.path, encoding="utf-8").read())
            for file in files
        ]
        return {"result": "pass"}

    monkeypatch.setattr(agent, "_run_agent_with_file_read_tool", fake_file_read_agent)
    monkeypatch.setattr(agent, "_should_use_document_block", lambda *args: False)
    docx = write_package(tmp_path, "b.docx", document_parts())

    result = agent._execute_review_core(
        files=[ReviewFile(docx, "申請書.docx")],
        has_images=False,
        check_name="check",
        check_description="description",
        language_name="日本語",
        model_id=MODEL_ID,
        toolConfiguration=None,
        feedback_summary=None,
    )

    [(path, name, text)] = seen["files"]
    assert path.endswith("office-1.md")
    assert name == "申請書.docx"
    assert text.startswith("# 申請書.docx\n")
    assert not os.path.exists(path)
    assert result["sources"] == []


def test_sources_keep_only_well_formed_entries():
    assert agent._normalize_sources(
        [
            {"file": " 見積書.xlsx ", "page": None},
            {"file": "稟議書.pdf", "page": 3},
            {"file": "zero.pdf", "page": 0},
            {"file": "flag.pdf", "page": True},
            {"file": "   "},
            {"page": 2},
            "not a source",
        ]
    ) == [
        {"file": "見積書.xlsx", "page": None},
        {"file": "稟議書.pdf", "page": 3},
        {"file": "zero.pdf", "page": None},
        {"file": "flag.pdf", "page": None},
    ]
    assert agent._normalize_sources("not a list") == []


@pytest.mark.parametrize("use_citations", [False, True])
def test_document_prompts_ask_which_files_the_judgment_relies_on(use_citations):
    prompt = agent.get_document_review_prompt(
        "日本語", "check", "description", use_citations=use_citations
    )

    assert (
        '"sources": [{"file": "<file name>", "page": <page within that file, or null>}]'
        in prompt
    )
    assert "<sources_instruction>" in prompt
    assert 'Set "sources": [] (empty array)' in prompt


def test_files_too_large_for_one_request_are_read_through_document_tools(
    tmp_path, monkeypatch
):
    sent = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            sent["tools"] = [tool.tool_name for tool in kwargs["tools"]]

        def __call__(self, prompt):
            sent["prompt"] = prompt
            raise Sent

    monkeypatch.setattr(agent, "Agent", FakeAgent)
    monkeypatch.setattr(agent, "_should_use_document_block", lambda *args: True)
    monkeypatch.setattr("review_documents.MAX_DOCUMENT_BYTES", 1)
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    with pytest.raises(Sent):
        agent._execute_review_core(
            files=[ReviewFile(str(pdf), "図面.pdf")],
            has_images=False,
            check_name="check",
            check_description="description",
            language_name="日本語",
            model_id=MODEL_ID,
            toolConfiguration=None,
            feedback_summary=None,
        )

    assert sent["tools"][:2] == ["list_documents", "search_documents"]
    assert isinstance(sent["prompt"], str)
    assert "Call list_documents" in sent["prompt"]
    assert "file_read" not in sent["prompt"]


def test_images_are_shrunk_before_the_image_reader_reads_them(tmp_path, monkeypatch):
    from PIL import Image

    seen = {}

    def fake_file_read_agent(prompt, files, **kwargs):
        seen["formats"] = [Image.open(file.path).format for file in files]
        seen["names"] = [file.name for file in files]
        return {"result": "pass"}

    monkeypatch.setattr(agent, "_run_agent_with_file_read_tool", fake_file_read_agent)
    image = tmp_path / "doc_1.bmp"
    Image.new("RGB", (10, 10)).save(image)

    agent._execute_review_core(
        files=[ReviewFile(str(image), "現場写真.bmp")],
        has_images=True,
        check_name="check",
        check_description="description",
        language_name="日本語",
        model_id=MODEL_ID,
        toolConfiguration=None,
        feedback_summary=None,
    )

    assert seen == {"formats": ["JPEG"], "names": ["現場写真.bmp"]}


def test_a_transcribed_file_is_read_through_document_tools(tmp_path, monkeypatch):
    """先に読み取ってある書類は、1回で渡せる大きさでも道具で読ませる。

    スキャンした短い PDF は、そのまま渡しても上限に当たらない。この分岐が
    ないと、せっかくの書き起こしを使わずに中身の薄い判定になる
    """
    from document_digest import DocumentDigest, PageDigest

    sent = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            sent["tools"] = [tool.tool_name for tool in kwargs["tools"]]

        def __call__(self, prompt):
            sent["prompt"] = prompt
            raise Sent

    monkeypatch.setattr(agent, "Agent", FakeAgent)
    # そのまま渡せる、と判断される状況をあえて作る
    monkeypatch.setattr(agent, "_should_use_document_block", lambda *args: True)
    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    with pytest.raises(Sent):
        agent._execute_review_core(
            files=[ReviewFile(str(pdf), "申込書.pdf")],
            has_images=False,
            check_name="check",
            check_description="description",
            language_name="日本語",
            model_id=MODEL_ID,
            toolConfiguration=None,
            feedback_summary=None,
            digests={
                str(pdf): DocumentDigest(pages=[PageDigest(page=1, text="申込者 山田")])
            },
        )

    assert sent["tools"][:2] == ["list_documents", "search_documents"]


def test_a_file_with_no_transcription_is_sent_as_it_is(tmp_path, monkeypatch):
    """読み取りを回していない書類の扱いは変わらない"""
    sent = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            pass

        def __call__(self, content):
            sent["content"] = content
            raise Sent

    monkeypatch.setattr(agent, "Agent", FakeAgent)
    monkeypatch.setattr(agent, "_should_use_document_block", lambda *args: True)
    pdf = tmp_path / "plain.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    with pytest.raises(Sent):
        agent._execute_review_core(
            files=[ReviewFile(str(pdf), "契約書.pdf")],
            has_images=False,
            check_name="check",
            check_description="description",
            language_name="日本語",
            model_id=MODEL_ID,
            toolConfiguration=None,
            feedback_summary=None,
            digests={},
        )

    # そのまま渡す経路は、中身を組み立ててモデルに渡す
    assert any("document" in block for block in sent["content"])
