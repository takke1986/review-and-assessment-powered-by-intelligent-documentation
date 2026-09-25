"""構造化出力で答えを受け取る部分"""

import pytest
from pydantic import ValidationError
from strands.types.exceptions import StructuredOutputException

import agent
import review_output
import review_prompts


def test_the_answer_can_only_be_pass_or_fail():
    with pytest.raises(ValidationError):
        review_output.DocumentReview(
            result="合格", confidence=0.9, explanation="x", shortExplanation="x"
        )
    with pytest.raises(ValidationError):
        review_output.DocumentReview(
            result="pass", confidence=1.5, explanation="x", shortExplanation="x"
        )


def test_prompts_ask_for_the_output_tool_instead_of_marked_json():
    for prompt in (
        review_prompts.get_document_review_prompt("日本語", "n", "d"),
        review_prompts.get_image_review_prompt(
            "日本語", "n", "d", "global.anthropic.claude-sonnet-4-6"
        ),
    ):
        adapted = review_output.adapt_prompt(prompt)
        assert "<<JSON_START>>" not in adapted
        assert "output tool" in adapted


def test_citations_become_the_extracted_text_only_on_the_citation_route():
    answer = review_output.DocumentReview(
        result="fail",
        confidence=0.4,
        explanation="x",
        shortExplanation="x",
        citations=["合計（税込） 110,000円"],
    )
    assert review_output.to_result(answer, use_citations=True)["extractedText"] == [
        "合計（税込） 110,000円"
    ]
    plain = review_output.to_result(answer, use_citations=False)
    assert "citations" not in plain and plain["extractedText"] == ""


class _Response:
    def __init__(self, answer=None):
        self.structured_output = answer
        self.message = {"content": [{"text": "fallback"}]}


def test_falls_back_to_reading_the_text_when_the_model_skips_the_tool(monkeypatch):
    monkeypatch.setenv("REVIEW_STRUCTURED_OUTPUT", "1")
    calls = []

    class FakeAgent:
        messages = ["earlier turn"]

        def __call__(self, request, **kwargs):
            calls.append(kwargs)
            if "structured_output_model" in kwargs:
                raise StructuredOutputException("did not call the tool")
            return _Response()

    response, answer = agent._ask(FakeAgent(), "prompt", review_output.DocumentReview)
    assert answer is None
    assert len(calls) == 2 and calls[1] == {}


def test_other_errors_are_not_retried(monkeypatch):
    # 本物のエラーのたびに黙って呼び直すと、費用が二重にかかる
    monkeypatch.setenv("REVIEW_STRUCTURED_OUTPUT", "1")
    calls = []

    class FakeAgent:
        messages = []

        def __call__(self, request, **kwargs):
            calls.append(kwargs)
            raise RuntimeError("ThrottlingException")

    with pytest.raises(RuntimeError):
        agent._ask(FakeAgent(), "prompt", review_output.DocumentReview)
    assert len(calls) == 1


def test_can_be_turned_off(monkeypatch):
    monkeypatch.setenv("REVIEW_STRUCTURED_OUTPUT", "0")
    calls = []

    class FakeAgent:
        def __call__(self, request, **kwargs):
            calls.append(kwargs)
            return _Response()

    agent._ask(FakeAgent(), "prompt", review_output.DocumentReview)
    assert calls == [{}]
