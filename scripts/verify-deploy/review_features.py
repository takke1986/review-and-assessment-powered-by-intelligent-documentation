"""審査の機能。スキャンした60ページの契約書（47ページ目に条項）を前読み・検索で見つけること、
読んだ範囲が記録されて画面に出ること、記入欄にだけ値がある申込書を読めること、
判定が pass / fail のどちらかであること。審査を2件流す（前読みを含めて $1 弱）。

    python3 scripts/verify-deploy/review_features.py

AGENT_LOG_GROUP を渡すと、審査が前読みの書き起こしを使ったことをログでも確かめる。
"""

import os
import re
import subprocess
import sys
import time

from common import BOTH, REGION, SALES, URL, Checks, Session, browser, stamp

CSV = ("チェック項目,説明\n"
       "反社会的勢力排除条項,契約書に、反社会的勢力の排除（表明保証と、違反時の解除）を定めた条項があること\n"
       "申込者氏名の記入,申込書の申込者氏名欄に、氏名が記入されていること\n")


def find(rows, *words):
    for r in rows:
        item = r.get("checkList") or {}
        if any(w in item.get("name", "") + item.get("description", "") for w in words):
            return r
    return None


c = Checks()
created: dict = {}
with browser() as b:
    sales, both = Session(b, SALES), Session(b, BOTH)
    name = f"確認_審査_{stamp()}"
    try:
        set_id = sales.create_checklist(name, CSV)
        created["set"] = set_id
        scan = both.start_review(set_id, "スキャン-長い契約書-反社あり.pdf", f"{name}_scan")
        created["scan"] = scan
        form = both.start_review(set_id, "申込書-記入済み.pdf", f"{name}_form")
        created["form"] = form
        c.check("スキャン60ページの審査が終わる", both.wait_review(scan) == "completed")
        c.check("記入済み申込書の審査が終わる", both.wait_review(form) == "completed")

        if os.environ.get("AGENT_LOG_GROUP"):
            out = subprocess.run(["aws", "logs", "filter-log-events", "--region", REGION,
                "--log-group-name", os.environ["AGENT_LOG_GROUP"],
                "--start-time", str(int((time.time() - 1800) * 1000)),
                "--filter-pattern", f'"{scan}" "Using the transcription"',
                "--query", "length(events)", "--output", "text"], capture_output=True, text=True).stdout.split()
            c.check("前読みの書き起こしを使った", sum(int(x) for x in out if x.isdigit()) > 0, out)

        rows = both.results(scan) + both.results(form)
        anti = find(both.results(scan), "反社", "Anti", "anti")
        c.check("47ページ目の条項を見つけて合格", anti is not None and anti.get("result") == "pass",
                anti and anti.get("shortExplanation"))
        coverage = ((anti or {}).get("reviewMeta") or {}).get("coverage") or []
        c.check("読んだ範囲が記録される", bool(coverage) and coverage[0]["total"] == 60,
                "; ".join(f"{x['read']}/{x['total']}" for x in coverage))
        applicant = find(both.results(form), "氏名", "Name", "name")
        c.check("記入欄の氏名を読んで合格", applicant is not None and applicant.get("result") == "pass",
                applicant and applicant.get("shortExplanation"))
        c.check("判定はすべて pass か fail", all(r.get("result") in ("pass", "fail") for r in rows),
                [r.get("result") for r in rows])

        # 画面: 合格の項目に「本文を読んだのは」が出る（既定の絞り込みは不合格なので切り替える）
        both.page.goto(f"{URL}/review/{scan}", wait_until="networkidle")
        both.page.wait_for_timeout(3000)
        both.page.locator("label", has_text="合格").filter(has_not_text="不合格").first.click()
        both.page.wait_for_timeout(2000)
        text = both.page.inner_text("body")
        shown = re.findall(r"[^\n]*本文を読んだのは[^\n]*", text) or re.findall(r"[^\n]*read the text of[^\n]*", text)
        c.check("画面に読んだ範囲が出る", bool(shown), shown[:1])
    finally:
        for key in ("scan", "form"):
            if key in created:
                print("片付け 審査", both.api("DELETE", f"/review-jobs/{created[key]}")[0])
        if "set" in created:
            print("片付け チェックリスト", sales.api("DELETE", f"/checklist-sets/{created['set']}")[0])

sys.exit(c.summary())
