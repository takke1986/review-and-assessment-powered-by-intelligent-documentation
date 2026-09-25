"""デプロイ後の確認スクリプトの共通部品。

画面に実際にログインして（Cognito）、そのトークンで API を呼ぶ。環境ごとに
違う値は環境変数で渡す。パスワードはリポジトリに書かない。

    RAPID_URL        画面の URL（例 https://xxxx.cloudfront.net）
    RAPID_API        API の URL（例 https://xxxx.execute-api.ap-northeast-1.amazonaws.com/api）
    RAPID_PW         テスト用アカウントの共通パスワード
    RAPID_SALES      営業部だけに属するアカウント（既定 rapid-sales@example.com）
    RAPID_LEGAL      法務部だけに属するアカウント（既定 rapid-legal@example.com）
    RAPID_BOTH       営業部と法務部を兼務するアカウント（既定 rapid-both@example.com）
    DOCUMENT_BUCKET  文書バケット（ファイルの削除を確かめるときだけ）
    AGENT_LOG_GROUP  審査エージェントのロググループ（前読みの利用を確かめるときだけ）

画面が稼働時間外に閉じる設定なら、URL に ?open=1 を付けて入る。
"""

import base64
import os
import subprocess
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = os.environ["RAPID_URL"].rstrip("/")
API = os.environ["RAPID_API"].rstrip("/")
SALES = os.environ.get("RAPID_SALES", "rapid-sales@example.com")
LEGAL = os.environ.get("RAPID_LEGAL", "rapid-legal@example.com")
BOTH = os.environ.get("RAPID_BOTH", "rapid-both@example.com")
REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
# 評価セットの架空の書類を、審査にかける書類として使う
FIXTURES = Path(__file__).resolve().parents[2] / "review-item-processor" / "eval" / "fixtures"

_CALL = """async ([api, method, path, body]) => {
  const k = Object.keys(localStorage).find(k => k.endsWith('.idToken'));
  const r = await fetch(api + path, { method, headers: { Authorization: 'Bearer ' + localStorage.getItem(k),
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
}"""
_PUT = """async ([url, ct, b64]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': ct }, body: bytes });
  return r.status;
}"""


class Checks:
    """確認の結果を数える。最後に summary() で終了コードを決める"""

    def __init__(self) -> None:
        self.results: list[bool] = []

    def check(self, label: str, ok: bool, detail: object = "") -> None:
        self.results.append(bool(ok))
        print(("OK  " if ok else "NG  ") + label + (f"  ({detail})" if detail != "" else ""), flush=True)

    def summary(self) -> int:
        print(f"\n{sum(self.results)}/{len(self.results)} OK")
        return 0 if all(self.results) else 1


class Session:
    """1人のアカウントでログインした画面。api() でそのアカウントとして API を呼ぶ"""

    def __init__(self, browser, user: str) -> None:
        self.page = browser.new_page(locale="ja-JP", viewport={"width": 1320, "height": 900})
        self.page.goto(URL + "/?open=1", wait_until="networkidle")
        self.page.evaluate("localStorage.setItem('onboarding_completed','true')")
        self.page.fill('input[name="username"]', user)
        self.page.fill('input[name="password"]', os.environ["RAPID_PW"])
        self.page.click('button[type="submit"]')
        self.page.wait_for_timeout(7000)
        self.page.evaluate("localStorage.setItem('onboarding_completed','true')")

    def api(self, method: str, path: str, body=None):
        return self.page.evaluate(_CALL, [API, method, path, body])

    def upload(self, endpoint: str, filename: str, data: bytes) -> dict:
        """アップロード先を発行してもらい、サーバが決めた Content-Type で上げる"""
        status, j = self.api("POST", endpoint, {"filename": filename, "contentType": "application/octet-stream"})
        assert status == 200, (status, j)
        d = j["data"]
        put = self.page.evaluate(_PUT, [d["url"], d["contentType"], base64.b64encode(data).decode()])
        assert put == 200, put
        return d

    def create_checklist(self, name: str, csv: str) -> str:
        """CSV からチェックリストを作り、読み取りが終わるまで待つ。ID を返す"""
        d = self.upload("/documents/checklist/presigned-url", "verify.csv", csv.encode("utf-8"))
        status, _ = self.api("POST", "/checklist-sets", {"name": name, "description": "デプロイ後の確認用。最後に削除する",
            "documents": [{"documentId": d["documentId"], "filename": "verify.csv", "s3Key": d["key"], "fileType": "text/csv"}]})
        assert status in (200, 201), status
        _, j = self.api("GET", f"/checklist-sets?page=1&limit=10&search={name}")
        set_id = j["data"]["checkListSets"][0]["checkListSetId"]
        for _ in range(60):
            _, j = self.api("GET", f"/checklist-sets/{set_id}")
            if j["data"]["processingStatus"] in ("completed", "failed"):
                break
            time.sleep(10)
        return set_id

    def start_review(self, set_id: str, fixture: str, name: str, department: str = "営業部") -> str:
        """評価セットの書類で審査を始め、ID を返す"""
        data = (FIXTURES / fixture).read_bytes()
        d = self.upload("/documents/review/presigned-url", fixture, data)
        status, j = self.api("POST", "/review-jobs", {"name": name, "checkListSetId": set_id, "departmentId": department,
            "documents": [{"id": d["documentId"], "filename": fixture, "s3Key": d["key"], "fileType": "pdf"}]})
        assert status in (200, 201), (status, j)
        _, j = self.api("GET", f"/review-jobs?page=1&limit=10&search={name}")
        job = j["data"]["items"][0]
        return job.get("id") or job.get("reviewJobId")

    def wait_review(self, job_id: str, minutes: int = 15) -> str:
        for _ in range(minutes * 6):
            _, j = self.api("GET", f"/review-jobs/{job_id}")
            status = j["data"]["status"]
            if status in ("completed", "failed", "cancelled"):
                return status
            time.sleep(10)
        return "timeout"

    def results(self, job_id: str) -> list[dict]:
        """審査結果のうち、子を持たない項目"""
        _, j = self.api("GET", f"/review-jobs/{job_id}/results/items?includeAllChildren=true")
        data = j["data"]
        rows = data if isinstance(data, list) else (data.get("items") or data.get("results") or [])
        return [r for r in rows if not r.get("hasChildren")]


def browser():
    """with browser() as b: の形で使う"""
    class _Ctx:
        def __enter__(self):
            self._p = sync_playwright().start()
            self._b = self._p.chromium.launch()
            return self._b

        def __exit__(self, *exc):
            self._b.close()
            self._p.stop()

    return _Ctx()


def stamp() -> str:
    return time.strftime("%m%d%H%M")


def s3_keys(prefix: str) -> list[str]:
    """文書バケットの、その場所の下のキー"""
    bucket = os.environ["DOCUMENT_BUCKET"]
    out = subprocess.run(["aws", "s3", "ls", f"s3://{bucket}/{prefix}", "--recursive", "--region", REGION],
                         capture_output=True, text=True).stdout
    return [line.split(None, 3)[3] for line in out.splitlines() if line.strip()]
