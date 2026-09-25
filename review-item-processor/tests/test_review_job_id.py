"""検証環境の入口から、前読みを読むところまでジョブ ID が届くこと。
9/21 から渡っておらず、検証環境の審査は前読みを一度も使っていなかった"""

import agent
import digest_store


def test_process_review_passes_the_job_id_on(monkeypatch):
    seen = {}

    def fake_from_s3(**kwargs):
        seen.update(kwargs)
        return {"result": "pass"}

    monkeypatch.setattr(agent, "process_review_from_s3", fake_from_s3)
    agent.process_review("bucket", ["review/original/D/a.pdf"], "項目", "説明",
                         review_job_id="JOB1")
    assert seen["review_job_id"] == "JOB1"


def test_loading_without_a_job_id_says_so(caplog):
    assert digest_store.load_for_documents("bucket", {"k": "/tmp/k"}, "", s3=object()) == {}
    assert "No review job id" in caplog.text


def test_the_agentcore_entry_passes_the_job_id_on(monkeypatch):
    # AgentCore の入口（index.handler）→ process_review の段でも落とさないこと
    import index

    seen = {}

    def fake_process_review(**kwargs):
        seen.update(kwargs)
        return {"result": "pass", "confidence": 0.9, "explanation": "x",
                "shortExplanation": "x", "reviewMeta": {}}

    class FakeTemp:
        def __init__(self, *args, **kwargs):
            pass

        def store(self, result):
            return result

    monkeypatch.setattr(index, "process_review", fake_process_review)
    monkeypatch.setattr(index, "S3TempStorage", FakeTemp)
    monkeypatch.setenv("DOCUMENT_BUCKET", "docs")
    monkeypatch.setenv("BEDROCK_REGION", "us-west-2")
    index.handler(
        {
            "reviewJobId": "JOB1",
            "checkId": "C1",
            "reviewResultId": "R1",
            "documentPaths": ["review/original/D/a.pdf"],
            "checkName": "項目",
            "checkDescription": "説明",
            "languageName": "日本語",
        },
        None,
    )
    assert seen.get("review_job_id") == "JOB1"
