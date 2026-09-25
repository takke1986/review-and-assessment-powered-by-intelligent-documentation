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
