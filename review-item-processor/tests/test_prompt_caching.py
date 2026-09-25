#!/usr/bin/env python3
"""
Tests for document/image prompt caching (auto cache strategy).
"""

import os
import sys

# Add parent directory to path (same convention as the other suites).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import agent
from strands.models import BedrockModel
from strands.models.model import CacheConfig
from strands.types.content import Messages


def test_apply_cache_config_uses_auto_strategy():
    cfg = {"model_id": "global.anthropic.claude-sonnet-4-6"}
    agent._apply_cache_config(cfg)

    assert isinstance(cfg["cache_config"], CacheConfig)
    assert cfg["cache_config"].strategy == "auto"
    assert cfg["cache_tools"] == "default"
    assert "cache_prompt" not in cfg  # deprecated key no longer used


def test_supports_caching_gates_cache_config():
    """Unregistered models fall back to no caching (fail-safe)."""
    assert agent.supports_caching("global.anthropic.claude-sonnet-4-6") is True
    assert agent.supports_caching("some.unregistered.model-id") is False


def _formatted_content(content):
    model = BedrockModel(
        model_id="global.anthropic.claude-sonnet-4-6",
        cache_config=CacheConfig(strategy="auto"),
    )
    messages: Messages = [{"role": "user", "content": content}]
    return model._format_bedrock_messages(messages)[0]["content"]


def _kinds(content):
    return [next(iter(block)) for block in content]


DOCUMENT = {
    "document": {
        "name": "review_doc",
        "format": "pdf",
        "source": {"bytes": b"%PDF-1.4 fake pdf bytes"},
    }
}
PROMPT = {"text": "Evaluate this document against the check item."}


def test_auto_strategy_alone_caches_the_per_item_prompt_too():
    """区切りを自分で置く理由。

    auto に任せると区切りがメッセージの末尾に付き、項目ごとに変わる指示文まで
    キャッシュの範囲に入る。すると毎回書き込むだけで、一度も読まれない
    """
    assert _kinds(_formatted_content([DOCUMENT, PROMPT])) == [
        "document",
        "text",
        "cachePoint",
    ]


def test_a_cache_point_placed_after_the_documents_is_kept_there():
    """この修正が頼っている SDK の約束: 呼び出し側が置いた区切りはその位置に残る"""
    content = _formatted_content(
        [DOCUMENT, {"cachePoint": {"type": "default"}}, PROMPT]
    )
    assert _kinds(content) == ["document", "cachePoint", "text"]


class _Sent(Exception):
    pass


def _sent_kinds(monkeypatch, tmp_path, model_id):
    """_run_agent_with_document_block が Bedrock へ送る並び"""
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake pdf bytes")
    sent = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            pass

        def __call__(self, content, **kwargs):
            sent["content"] = content
            raise _Sent

    monkeypatch.setattr(agent, "Agent", FakeAgent)
    try:
        agent._run_agent_with_document_block(
            "Evaluate this document against the check item.",
            [agent.ReviewFile(path=str(pdf), name="doc.pdf")],
            model_id,
        )
    except _Sent:
        pass
    return _kinds(sent["content"])


def test_documents_are_cached_without_the_per_item_prompt(monkeypatch, tmp_path):
    """区切りは書類の直後・指示文の前。項目をまたいで書類が読まれるのはこの形だけ"""
    kinds = _sent_kinds(monkeypatch, tmp_path, "global.anthropic.claude-sonnet-4-6")
    assert kinds[-2:] == ["cachePoint", "text"]
    assert kinds.index("cachePoint") > kinds.index("document")


def test_no_cache_point_for_a_model_without_caching(monkeypatch, tmp_path):
    kinds = _sent_kinds(monkeypatch, tmp_path, "some.unregistered.model-id")
    assert "cachePoint" not in kinds
