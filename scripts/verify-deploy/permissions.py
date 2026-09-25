"""部署の権限。営業部のチェックリストを、同じ部署の人は見て直せるが消せず、
他部署の人は開けないこと。審査を1件流す（費用は数円）。最後に作ったものを消す。

    python3 scripts/verify-deploy/permissions.py
"""

import sys

from common import BOTH, LEGAL, SALES, Checks, Session, browser, stamp

CSV = "チェック項目,説明\n合計金額（税込）の記載,見積書に、消費税を含む合計金額が明記されていること\n"

c = Checks()
created: dict = {}
with browser() as b:
    sales, both, legal = Session(b, SALES), Session(b, BOTH), Session(b, LEGAL)
    name = f"確認_権限_{stamp()}"
    try:
        set_id = sales.create_checklist(name, CSV)
        created["set"] = set_id
        _, j = sales.api("GET", f"/checklist-sets/{set_id}/items?includeAllChildren=true")
        items = j["data"] if isinstance(j["data"], list) else j["data"].get("items", [])
        item = items[0]

        status, j = both.api("GET", f"/checklist-sets/{set_id}")
        c.check("同じ部署の人は詳細を開ける", status == 200, status)
        c.check("同じ部署の人には削除不可と返る", status == 200 and j["data"].get("canDelete") is False)
        status, _ = both.api("PUT", f"/checklist-sets/{set_id}/items/{item['id']}",
                             {"name": item["name"], "description": item.get("description") or "", "resolveAmbiguity": False})
        c.check("同じ部署の人は項目を直せる", status == 200, status)
        status, _ = both.api("PATCH", f"/checklist-sets/{set_id}/items/{item['id']}/review-guidance",
                             {"reviewGuidance": "右下の合計金額の欄を見る"})
        c.check("同じ部署の人は着眼点を書ける", status == 200, status)
        _, j = both.api("GET", f"/checklist-sets/{set_id}")
        c.check("最後に直した日時が残る", bool(j["data"].get("lastEditedAt")), j["data"].get("lastEditedAt"))
        status, _ = both.api("DELETE", f"/checklist-sets/{set_id}/items/{item['id']}/feedback-summary")
        c.check("同じ部署の人は過去の指摘の要約を消せる", status == 200, status)
        status, _ = both.api("DELETE", f"/checklist-sets/{set_id}")
        c.check("同じ部署の人はチェックリストを消せない", status == 403, status)

        status, _ = legal.api("GET", f"/checklist-sets/{set_id}")
        c.check("他部署の人は開けない", status == 403, status)
        status, _ = legal.api("DELETE", f"/checklist-sets/{set_id}/items/{item['id']}/feedback-summary")
        c.check("他部署の人は要約を消せない", status == 403, status)

        job = both.start_review(set_id, "amount-present.pdf", f"{name}_審査")
        created["job"] = job
        c.check("同じ部署のチェックリストで審査できる", both.wait_review(job) == "completed")
        _, j = both.api("GET", f"/review-jobs/{job}")
        key = j["data"]["documents"][0]["s3Path"]
        status, _ = both.api("GET", f"/documents/download-url?key={key}")
        c.check("見てよい審査の文書は取り出せる", status == 200, status)
        status, _ = legal.api("GET", f"/documents/download-url?key={key}")
        c.check("他部署の人は取り出せない", status == 403, status)
    finally:
        if "job" in created:
            print("片付け 審査", both.api("DELETE", f"/review-jobs/{created['job']}")[0])
        if "set" in created:
            print("片付け チェックリスト", sales.api("DELETE", f"/checklist-sets/{created['set']}")[0])

sys.exit(c.summary())
