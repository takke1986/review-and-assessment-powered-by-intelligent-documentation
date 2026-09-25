"""疎通と、権限・アップロードの守り。ほかのデータには触れない（1件だけアップロードして消す）。

    python3 scripts/verify-deploy/smoke_and_security.py
"""

import sys

from common import BOTH, Checks, Session, browser

c = Checks()
with browser() as b:
    both = Session(b, BOTH)
    for path in ["/user/preference", "/checklist-sets?page=1&limit=5", "/review-jobs?page=1&limit=5",
                 "/review-jobs/cost-summary", "/checklist-set-trends?page=1&limit=5&sortBy=name&sortOrder=asc",
                 "/prompt-templates/checklist?page=1&limit=5", "/tool-configurations"]:
        status, _ = both.api("GET", path)
        c.check(f"疎通 {path}", status == 200, status)

    # ツール設定のプレビューは送られた command を実行するので、管理者だけ。
    # 万一通っても何も実行されないよう、接続できない URL にしてある
    status, _ = both.api("POST", "/tool-configurations/preview-tools", {"mcpConfig": {"x": {"url": "http://127.0.0.1:9/"}}})
    c.check("一般ユーザーはツールのプレビューを使えない", status == 403, status)

    status, _ = both.api("GET", "/documents/download-url?key=anything.txt&bucket=some-other-bucket")
    c.check("ほかのバケットのファイルは取り出せない", status == 403, status)
    status, _ = both.api("GET", "/documents/download-url?key=review/original/NOPE/x.pdf")
    c.check("審査の文書でないキーは 404", status == 404, status)

    status, _ = both.api("POST", "/documents/review/presigned-url", {"filename": "page.html", "contentType": "text/html"})
    c.check("html はアップロードさせない", status in (400, 422), status)
    status, _ = both.api("POST", "/documents/checklist/presigned-url", {"filename": "logo.svg", "contentType": "image/svg+xml"})
    c.check("svg はアップロードさせない", status in (400, 422), status)

    # PDF は、サーバが決めた Content-Type で上げられ、使われていなければ文書 ID で消せる
    d = both.upload("/documents/review/presigned-url", "verify.pdf", b"%PDF-1.4\n%%EOF")
    c.check("PDF の Content-Type はサーバが決める", d["contentType"] == "application/pdf", d["contentType"])
    status, _ = both.api("GET", "/documents/download-url?key=" + d["key"])
    c.check("審査に使われていないアップロードは取り出せない", status == 404, status)
    status, _ = both.api("DELETE", "/documents/review/" + d["documentId"])
    c.check("使われていないアップロードは文書 ID で消せる", status == 200, status)
    status, _ = both.api("DELETE", "/documents/review/review%2Foriginal%2FX%2Fa.pdf")
    c.check("キーを送っても消さない", status == 403, status)

    status, _ = both.api("GET", "/prompt-templates/id/01ZZZZZZZZZZZZZZZZZZZZZZZZ")
    c.check("存在しないプロンプトは 404", status == 404, status)

sys.exit(c.summary())
