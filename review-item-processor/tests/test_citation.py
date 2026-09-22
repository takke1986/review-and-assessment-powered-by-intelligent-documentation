#!/usr/bin/env python3
"""Citation tests for agent.py.

Offline tests cover _choose_route (routing) and
_extract_citations_text (parsing). An opt-in Bedrock integration test runs only
with RUN_BEDROCK_INTEGRATION=1 (needs AWS credentials).
"""
import os
import sys
from pathlib import Path

import pytest

# Add parent directory to path so `import agent` works when run from any cwd.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import agent
from agent import (
    ROUTE_DOCUMENT_BLOCK,
    ROUTE_DOCUMENT_TOOLS,
    ROUTE_FILE_READ,
    _choose_route,
    _extract_citations_text,
)
from model_config import ModelConfig

# A registered model that supports the document block + citations.
CITATION_MODEL_ID = "global.anthropic.claude-sonnet-4-6"
# An unregistered model falls back to _DEFAULT_CONFIG (no document block).
UNKNOWN_MODEL_ID = "example.unknown-model-v1"


# ---------------------------------------------------------------------------
# _choose_route: 経路の選択
# ---------------------------------------------------------------------------


def test_document_block_used_for_pdf_when_citations_enabled(monkeypatch):
    """PDF + citations enabled + capable model -> document block path."""
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", True)
    assert (
        _choose_route(["/tmp/a.pdf"], CITATION_MODEL_ID, has_images=False)
        == ROUTE_DOCUMENT_BLOCK
    )


def test_file_read_used_when_citations_disabled(monkeypatch):
    """ENABLE_CITATIONS=false falls back to the file_read tool path."""
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", False)
    assert (
        _choose_route(["/tmp/a.pdf"], CITATION_MODEL_ID, has_images=False)
        == ROUTE_FILE_READ
    )


def test_file_read_used_for_images(monkeypatch):
    """Images always use the file_read/image_reader path, regardless of the flag."""
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", True)
    assert (
        _choose_route(["/tmp/a.png"], CITATION_MODEL_ID, has_images=True)
        == ROUTE_FILE_READ
    )


def test_file_read_used_for_unknown_model(monkeypatch):
    """Unknown models fall back to defaults without document block support."""
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", True)
    assert (
        _choose_route(["/tmp/a.pdf"], UNKNOWN_MODEL_ID, has_images=False)
        == ROUTE_FILE_READ
    )


def test_default_model_supports_citation():
    """The default model supports the document block and citations."""
    config = ModelConfig.create(CITATION_MODEL_ID)
    assert config.supports_document_block is True
    assert config.supports_citation is True


# ---------------------------------------------------------------------------
# _extract_citations_text: citations parsing from the JSON response
# ---------------------------------------------------------------------------


def _message_with_text(text: str) -> dict:
    """Build an AgentResult.message-shaped dict with a single text block."""
    return {"content": [{"text": text}]}


def test_extract_citations_returns_array():
    """A citations array in the marker JSON is returned as-is."""
    message = _message_with_text(
        '<<JSON_START>>{"result": "pass",'
        ' "citations": ["p.3 保管スペース", "p.5 避難経路"]}<<JSON_END>>'
    )
    assert _extract_citations_text(message) == ["p.3 保管スペース", "p.5 避難経路"]


def test_extract_citations_empty_when_absent():
    """JSON without a citations field yields an empty list."""
    message = _message_with_text('<<JSON_START>>{"result": "pass"}<<JSON_END>>')
    assert _extract_citations_text(message) == []


def test_extract_citations_empty_on_non_json():
    """Non-JSON output yields an empty list instead of raising."""
    assert _extract_citations_text(_message_with_text("no json here")) == []


# ---------------------------------------------------------------------------
# Opt-in Bedrock integration test (real API call, requires AWS credentials)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    os.environ.get("RUN_BEDROCK_INTEGRATION") != "1",
    reason="Set RUN_BEDROCK_INTEGRATION=1 to run the live Bedrock integration test",
)
def test_citation_review_integration():
    """Run a real review over the bundled sample PDF via the citations path."""
    test_pdf = Path(__file__).parent / "office_planning.pdf"
    assert test_pdf.exists(), f"Test file not found: {test_pdf}"

    from agent import process_review_from_local

    result = process_review_from_local(
        document_paths=[str(test_pdf)],
        check_name="保管スペース確保",
        check_description="指定エリア内に整理保管され、避難経路を塞いでいない",
        language_name="日本語",
    )

    assert result.get("result") in ["pass", "fail"]
    assert 0 <= result.get("confidence", 0) <= 1
    assert result.get("explanation", "") != ""
    assert result.get("reviewType") == "PDF"


if __name__ == "__main__":
    os.environ["RUN_BEDROCK_INTEGRATION"] = "1"
    test_citation_review_integration()
    print("Integration test passed")


def test_pdf_with_notes_goes_to_document_tools(monkeypatch):
    """注釈や記入値のある PDF は document_library の道具へ回す。

    以前は file_read に流れていた。その経路は本文に出ない中身を足さないので、
    注釈は最後まで読まれず、審査の答えに出なかった。実環境で
    「注釈内容を直接抽出できず」と返り、道具が1度も呼ばれていないことが
    ログで確認された。
    """
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", True)
    monkeypatch.setattr(agent, "has_hidden_content", lambda path: True)

    assert (
        _choose_route(["/tmp/申込書.pdf"], CITATION_MODEL_ID, has_images=False)
        == ROUTE_DOCUMENT_TOOLS
    )


def test_pdf_without_notes_stays_on_document_block(monkeypatch):
    """注釈が無ければ、そのまま渡す経路のまま"""
    monkeypatch.setattr(agent, "ENABLE_CITATIONS", True)
    monkeypatch.setattr(agent, "has_hidden_content", lambda path: False)

    assert (
        _choose_route(["/tmp/a.pdf"], CITATION_MODEL_ID, has_images=False)
        == ROUTE_DOCUMENT_BLOCK
    )
