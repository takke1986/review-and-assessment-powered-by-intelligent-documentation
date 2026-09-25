"""評価に使う、ローカルのファイルで審査する入口が呼べること。
以前は引数に無い名前を渡していて、呼ぶと必ず NameError で落ちていた"""

import agent


def test_process_review_from_local_reaches_the_review(monkeypatch, tmp_path):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    seen = {}

    def fake_core(**kwargs):
        seen.update(kwargs)
        return {"result": "pass"}

    monkeypatch.setattr(agent, "_execute_review_core", fake_core)
    result = agent.process_review_from_local([str(pdf)], "項目", "説明")
    assert result == {"result": "pass"}
    assert seen["check_name"] == "項目"
