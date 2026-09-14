#!/usr/bin/env python3
"""
Tests for how the review prompts ask for a decision.

The model writes the JSON fields in the order the schema lists them. With
"result" first it commits to a decision before reasoning, and when the
explanation then reaches the opposite conclusion the saved result contradicts
it. The prompts also need to say that a conditional check item whose
condition is not met passes, rather than failing because the conditional
requirement is not stated.
"""

import os
import re
import sys

import pytest

# Add parent directory to path (same convention as the other suites).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import agent

MODEL_ID = "global.anthropic.claude-sonnet-4-6"
NAME = "Monthly Unit Price Exceeding 3,000,000 JPY"
DESCRIPTION = (
    "If the monthly unit price per person exceeds 3,000,000 JPY, it must be "
    "stated that a review by the accounting department has been conducted."
)

PROMPTS = {
    "document": lambda: agent.get_document_review_prompt(
        "Japanese", NAME, DESCRIPTION, use_citations=False
    ),
    "document with citations": lambda: agent.get_document_review_prompt(
        "Japanese", NAME, DESCRIPTION, use_citations=True
    ),
    "image": lambda: agent.get_image_review_prompt(
        "Japanese", NAME, DESCRIPTION, MODEL_ID, None, None
    ),
}


def _schema(prompt: str) -> str:
    # The document prompts wrap the schema in markers; the image prompt
    # introduces it with "JSON format" and follows it with "REMEMBER".
    match = re.search(r"<<JSON_START>>(.*?)<<JSON_END>>", prompt, re.DOTALL)
    if not match:
        match = re.search(r"JSON format[^\n]*\n(.*?)\n\s*REMEMBER", prompt, re.DOTALL)
    assert match, "prompt has no JSON schema"
    return match.group(1)


def _position(schema: str, field: str) -> int:
    index = schema.find(f'"{field}"')
    assert index >= 0, f'schema has no "{field}"'
    return index


@pytest.mark.parametrize("kind", PROMPTS)
def test_result_comes_after_the_reasoning(kind):
    schema = _schema(PROMPTS[kind]())

    result = _position(schema, "result")
    assert _position(schema, "explanation") < result
    assert _position(schema, "shortExplanation") < result
    assert result < _position(schema, "confidence")


@pytest.mark.parametrize("kind", PROMPTS)
def test_result_must_match_the_explanation(kind):
    prompt = PROMPTS[kind]()

    assert "<RESULT_CONSISTENCY>" in prompt


@pytest.mark.parametrize("kind", PROMPTS)
def test_conditional_items_are_decided_before_missing_information(kind):
    prompt = PROMPTS[kind]()

    conditional = prompt.find("<CONDITIONAL_CHECK_ITEMS>")
    insufficient = prompt.find("<INSUFFICIENT_INFORMATION_HANDLING>")
    assert conditional >= 0
    assert conditional < insufficient
