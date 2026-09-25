"""審査やチェックリストを消すと、S3 のファイルも消えること。ほかがまだ使うファイルは残ること。

- 再審査は元の審査の書類を引き継ぐ: 再審査を消しても書類は残り、元の審査も消すと消える
- 複製したチェックリストは元の書類を共有する: 元を消しても残り、複製も消すと消える
- チェックリストを消すと、それを使った審査も一緒に消え、そのファイルも消える

審査を3件流す（数円）。DOCUMENT_BUCKET が要る（S3 を直接見る）。

    python3 scripts/verify-deploy/file_cleanup.py
"""

import sys
import time

from common import BOTH, SALES, Checks, Session, browser, s3_keys, stamp

CSV_ANTI = "チェック項目,説明\n反社会的勢力排除条項,契約書に、反社会的勢力の排除（表明保証と、違反時の解除）を定めた条項があること\n"
CSV_AMOUNT = "チェック項目,説明\n合計金額（税込）の記載,見積書に、消費税を含む合計金額が明記されていること\n"
DERIVED = ("processed", "pages", "llm_ocr", "aggregate")

c = Checks()
created: dict = {}
with browser() as b:
    sales, both = Session(b, SALES), Session(b, BOTH)
    name = f"確認_削除_{stamp()}"
    try:
        # 1. 審査と再審査
        set1 = sales.create_checklist(f"{name}_1", CSV_ANTI)
        created["set1"] = set1
        x = both.start_review(set1, "スキャン-契約書-反社なし.pdf", f"{name}_X")
        created["X"] = x
        both.wait_review(x)
        _, j = both.api("GET", f"/review-jobs/{x}")
        doc = j["data"]["documents"][0]
        key = doc["s3Path"]
        c.check("審査X: 書類と前読みが S3 にある", key in s3_keys(key) and bool(s3_keys(f"digest/{x}/")))
        status, _ = both.api("POST", "/review-jobs", {"name": f"{name}_Y", "checkListSetId": set1, "departmentId": "営業部",
            "documents": [], "keptDocumentIds": [doc["id"]], "sourceReviewJobId": x})
        c.check("再審査Y（書類を引き継ぐ）を作れる", status in (200, 201), status)
        _, j = both.api("GET", f"/review-jobs?page=1&limit=10&search={name}_Y")
        y = j["data"]["items"][0].get("id") or j["data"]["items"][0].get("reviewJobId")
        created["Y"] = y
        both.wait_review(y)
        both.api("DELETE", f"/review-jobs/{y}")
        created.pop("Y")
        time.sleep(3)
        c.check("Y を消すと Y の前読みが消える", s3_keys(f"digest/{y}/") == [])
        c.check("Y を消しても X が使う書類は残る", key in s3_keys(key))
        both.api("DELETE", f"/review-jobs/{x}")
        created.pop("X")
        time.sleep(3)
        c.check("X を消すと書類と前読みが消える", s3_keys(key) == [] and s3_keys(f"digest/{x}/") == [])

        # 2. チェックリストの複製と、チェックリストと一緒に消える審査
        set_a = sales.create_checklist(f"{name}_A", CSV_AMOUNT)
        created["A"] = set_a
        _, j = sales.api("GET", f"/checklist-sets/{set_a}")
        original, doc_id = j["data"]["documents"][0]["s3Key"], j["data"]["documents"][0]["id"]
        sales.api("POST", f"/checklist-sets/{set_a}/duplicate", {"name": f"{name}_B", "description": "確認用"})
        _, j = sales.api("GET", f"/checklist-sets?page=1&limit=10&search={name}_B")
        set_b = j["data"]["checkListSets"][0]["checkListSetId"]
        created["B"] = set_b
        job = both.start_review(set_a, "スキャン-見積書.pdf", f"{name}_job")
        created["job"] = job
        both.wait_review(job)
        _, j = both.api("GET", f"/review-jobs/{job}")
        job_key = j["data"]["documents"][0]["s3Path"]

        status, _ = sales.api("DELETE", f"/checklist-sets/{set_a}")  # 審査は消さずに
        created.pop("A")
        created.pop("job")
        time.sleep(3)
        left = [k for area in DERIVED for k in s3_keys(f"checklist/{area}/{doc_id}/")]
        c.check("A を消すとページの画像・読み取り結果などが消える", status == 200 and left == [], len(left))
        c.check("複製 B が共有する元の書類は残る", original in s3_keys(original))
        c.check("A と一緒に消えた審査の書類と前読みも消える", s3_keys(job_key) == [] and s3_keys(f"digest/{job}/") == [])
        sales.api("DELETE", f"/checklist-sets/{set_b}")
        created.pop("B")
        time.sleep(3)
        c.check("B も消すと元の書類が消える", s3_keys(original) == [])
    finally:
        for k in ("Y", "X", "job"):
            if k in created:
                print("片付け 審査", k, both.api("DELETE", f"/review-jobs/{created[k]}")[0])
        for k in ("A", "B", "set1"):
            if k in created:
                print("片付け チェックリスト", k, sales.api("DELETE", f"/checklist-sets/{created[k]}")[0])

sys.exit(c.summary())
