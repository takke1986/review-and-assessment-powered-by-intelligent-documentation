#!/usr/bin/env python3
"""
agent.py が、審査するファイルをモデルにどう渡し、根拠のファイルをどう受け取るかのテスト。
"""

import review_sources
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
    # 文書ブロックで渡せるのは PDF だけ。Office は文章として渡す。
    # md も txt も Bedrock か Strands のどちらかに断られるため
    assert [
        block["document"]["format"] for block in content if "document" in block
    ] == ["pdf"]
    # Office の中身は文章に入っている
    assert any(
        "申請書.docx" in block.get("text", "") for block in content if "text" in block
    )
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
    monkeypatch.setattr(
        agent, "_choose_route", lambda *args: agent.ROUTE_FILE_READ
    )
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


def _source(file, page=None, section=None, label=None):
    return {"file": file, "page": page, "section": section, "label": label}


def test_sources_keep_only_well_formed_entries():
    assert review_sources._normalize_sources(
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
        _source("見積書.xlsx"),
        _source("稟議書.pdf", page=3),
        _source("zero.pdf"),
        _source("flag.pdf"),
    ]
    assert review_sources._normalize_sources("not a list") == []


def test_office_sources_keep_the_place_within_the_file():
    """Office にはページが無いので、場所は label と section で持つ。
    ここで捨てると、根拠の場所が explanation の文章にしか残らない"""
    assert review_sources._normalize_sources(
        [
            {"file": "提案書.pptx", "page": None, "section": 3, "label": "Slide 3"},
            {"file": "見積.xlsx", "label": "Sheet: 売上高"},
            {"file": "規程.docx", "label": "  第2章 適用範囲  "},
        ]
    ) == [
        _source("提案書.pptx", section=3, label="Slide 3"),
        _source("見積.xlsx", label="Sheet: 売上高"),
        _source("規程.docx", label="第2章 適用範囲"),
    ]


def test_a_malformed_place_is_dropped_rather_than_stored():
    """節番号や場所が壊れていても、ファイル名まで捨てない"""
    assert review_sources._normalize_sources(
        [
            {"file": "a.pptx", "section": 0, "label": "   "},
            {"file": "b.pptx", "section": "3", "label": 7},
            {"file": "c.pptx", "section": True},
        ]
    ) == [_source("a.pptx"), _source("b.pptx"), _source("c.pptx")]


def test_a_long_place_is_cut_instead_of_carrying_the_body_text():
    """label は場所の欄。本文を丸ごと入れられても切る"""
    [source] = review_sources._normalize_sources(
        [{"file": "規程.docx", "label": "あ" * 200}]
    )
    assert source["label"] == "あ" * review_sources.MAX_SOURCE_LABEL_CHARS


@pytest.mark.parametrize("use_citations", [False, True])
def test_document_prompts_ask_which_files_the_judgment_relies_on(use_citations):
    prompt = agent.get_document_review_prompt(
        "日本語", "check", "description", use_citations=use_citations
    )

    assert '"sources": [{"file": "<file name>", ' in prompt
    # 場所の欄。PDF 以外でも根拠の場所を返させるために要る
    assert '"page": <page number in a PDF, or null>' in prompt
    assert '"section": <section number from list_documents, or null>' in prompt
    assert '"label": "<where in the file' in prompt
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
    monkeypatch.setattr(
        agent, "_choose_route", lambda *args: agent.ROUTE_DOCUMENT_BLOCK
    )
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
    monkeypatch.setattr(
        agent, "_choose_route", lambda *args: agent.ROUTE_DOCUMENT_BLOCK
    )
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
    monkeypatch.setattr(
        agent, "_choose_route", lambda *args: agent.ROUTE_DOCUMENT_BLOCK
    )
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


def test_a_pdf_with_notes_actually_runs_through_the_document_tools(
    tmp_path, monkeypatch
):
    """注釈のある PDF が、document_library の道具まで実際に届くか。

    経路の選択だけを見るテストはあったが、その先の実行を通していなかった。
    そのため分岐を足したときの組み立て忘れ（UnboundLocalError）に気づけず、
    審査が全部落ちた状態でデプロイしてしまった。
    """
    sent = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            sent["tools"] = [tool.tool_name for tool in kwargs["tools"]]
            sent["system_prompt"] = kwargs.get("system_prompt")

        def __call__(self, prompt):
            sent["prompt"] = prompt
            raise Sent

    monkeypatch.setattr(agent, "Agent", FakeAgent)
    # 注釈があると判定させる。経路の選択そのものは test_citation.py で見る
    monkeypatch.setattr(agent, "has_hidden_content", lambda path: True)
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", True)
    pdf = tmp_path / "a.pdf"
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
        )

    # document_library の道具が渡っている（file_read ではない）
    assert "list_documents" in sent["tools"]
    assert "read_pdf_pages" in sent["tools"]
    # 経路ごとに組み立て忘れていないか
    assert sent["system_prompt"], "system_prompt が渡っていない"
    assert "日本語" in sent["system_prompt"]
