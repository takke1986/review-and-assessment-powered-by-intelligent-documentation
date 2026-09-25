# デプロイ後の確認

デプロイのあと、画面に実際にログインして API を叩き、主な守りと機能が効いているかを
確かめるスクリプト。テスト用のアカウント（営業部・法務部・兼務）で動かす。作った
チェックリストや審査は、成否にかかわらず最後に消す。どれも全件 OK なら終了コード 0。

| スクリプト | 見ること | 審査 | 所要 |
|---|---|---|---|
| `smoke_and_security.py` | 疎通、ツールのプレビュー・取り出し・アップロード・削除の権限 | なし | 1分 |
| `permissions.py` | 部署の権限（同じ部署は直せるが消せない、他部署は開けない） | 1件 | 3分 |
| `review_features.py` | 前読み・検索・読んだ範囲・記入欄・判定の形 | 2件 | 3分 |
| `file_cleanup.py` | 審査・チェックリストを消すとファイルも消える、共有中は残る | 3件 | 6分 |

## 使い方

```sh
pip install playwright && playwright install chromium   # 初回だけ

export RAPID_URL=https://<画面の CloudFront>
export RAPID_API=https://<API Gateway>/api
export RAPID_PW=<テスト用アカウントの共通パスワード>
export DOCUMENT_BUCKET=<文書バケット>              # file_cleanup.py だけ
export AGENT_LOG_GROUP=<審査エージェントのロググループ> # review_features.py（任意）

cd scripts/verify-deploy
python3 smoke_and_security.py && python3 permissions.py \
  && python3 review_features.py && python3 file_cleanup.py
```

値はリポジトリに書かない（このリポジトリは公開）。環境の情報は別に受け渡す。

- テスト用アカウントは `RAPID_SALES`・`RAPID_LEGAL`・`RAPID_BOTH` で変えられる
  （既定は rapid-sales / rapid-legal / rapid-both @example.com）
- 画面が稼働時間外に閉じる設定なので、`?open=1` を付けて入る。稼働時間外は
  NAT が止まっていて API も動かないので、稼働時間内に流す（docs/03-運用.md）
- `review_features.py` と `file_cleanup.py` は、評価セットの架空の書類
  （`review-item-processor/eval/fixtures/`）を審査にかける
- `file_cleanup.py` は S3 を直接見るので、AWS の認証情報（文書バケットを読める
  もの）が要る
