# CLAUDE.md

引き継ぎ・全体像は `docs/` を参照（`01-全体像.md` から）。

## Critical Rules

- **NO package.json in root directory** - 3 separate TS packages + 1 Python package
- **Python: use `uv`** for all package management (never pip/python directly)
- **BEFORE COMMITTING** - format and build all changed packages (CI will fail):
  ```bash
  cd frontend && npm run format && npm run build   # Frontend
  cd backend && npm run format && npm run build     # Backend
  cd cdk && npm run build                           # CDK
  ```

## Project Structure

```
beacon/
├── backend/                 # Fastify REST API (TypeScript, ESM)
├── frontend/                # React SPA, Vite + Tailwind CSS
├── cdk/                     # AWS CDK infrastructure
└── review-item-processor/   # Python Lambda (use uv)
```

## Skills

- **`/plan-backend-frontend`** - Plan features with RAPID layered architecture
- **`/build-and-format`** - Build verification and formatting
- **`/test-database-feature`** - Repository integration tests with local MySQL
- **`/deploy-cdk-stack`** - CDK deployment (only when explicitly asked)
- **`/modify-cdk-workflows`** - CDK Step Functions workflows
- **`/modify-agent-prompts`** - Agent prompts, models, tools config
- **`/add-example`** - Add example use cases with thumbnails
- **`/ui-css-patterns`** - UI/CSS patterns and component reference

## Backend

- **TypeScript only** (ESM) -- JavaScript prohibited
- **vitest only** -- jest prohibited
- MySQL with **Prisma ORM** (schema: `backend/prisma/schema.prisma`)
- **Layered architecture**: `routes/ -> usecase/ -> domain/` (unidirectional deps)
  - Feature dirs: `src/api/features/{feature}/{ domain/, usecase/, routes/ }`
  - Dependency injection via optional `deps` params with defaults
- **Repository pattern MANDATORY** -- no direct Prisma calls in StepFunctions handlers (`src/checklist-workflow/`, `src/review-workflow/`)
  - Repository tests MUST connect to actual DB (not mocks)
  - Example tests: `backend/src/api/features/{feature}/__tests__/`
- Test commands: `cd backend && npm test` (all) or `npm run test -- <suite>` (specific)

## Frontend

- **TypeScript only** -- JavaScript prohibited
- **Icons**: use react-icons only -- SVG files prohibited
- **DO NOT modify** `frontend/tailwind.config.js`
- **No native `alert()`/`confirm()`** -- use `useAlert` hook + `AlertModal` component
- Use shared components from `frontend/src/components/` (e.g., `Button`, `Modal`) -- avoid raw `<button>` elements
- Feature-based structure: `features/{name}/hooks/`, `features/{name}/components/`
- API hooks: use `useApiClient`; split into `use{Feature}Queries.ts` / `use{Feature}Mutations.ts`
- Data fetching: SWR

## 読み取りと審査の流れ

書類は審査の前に読み取ることがある。詳しくは `docs/01-全体像.md` と
`docs/02-読み取り結果の持ち方.md`。押さえるべき点だけ挙げる。

- **段取りは TypeScript、判定は Python。** `review-item-processor/` は DB に
  繋がない（S3 と Bedrock だけ）。DB に残すものは状態機械で TS 側へ渡す
- **読み取りは審査の補助。** 落ちても審査は続ける。`addCatch` の `resultPath` を
  捨てないと、エラーが状態の入力を置き換えて実行ごと落ちる
- **読み取り結果の本文は S3、索引と状態は DB。** 対応はキーの規則ではなく
  実測値を行として持つ（`ReviewDocumentDigest` ほか2表）
- **Office は文書ブロックで渡せない。** 変換した Markdown を文章として渡す。
  引用はモデルが JSON で返す配列を読んでいるので残る
- **読み取り Lambda に `strands` を読み込むモジュールを積まない。**
  起動できなくなる。検査するテストがある

## 落とし穴

- **デプロイの終了コードだけを見ない。** `cdk deploy` はイメージのビルドに
  失敗しても 0 を返すことがある。ログの失敗行も確認する
- **デプロイ前にディスクの空きを確認する。** Docker のビルドキャッシュが
  膨らんで容量不足で落ちる
- **検索に使う列の照合順序は `utf8mb4_0900_as_ci`。** ID の列は
  `utf8mb4_unicode_ci` のまま（外部キーは参照先と揃える必要がある）。
  表の既定も揃えないと、将来の `MODIFY` で黙って戻る
- **一覧の並べ替えは許可列で縛っている。** 画面に列を足したらサーバ側にも足す。
  突き合わせるテストがある
- 時間外は画面が 503、API は 401 になる。**認証の問題ではなく NAT が止まっている**

## CDK

- Parameters: `cdk/lib/parameter.ts` (user config) + `cdk/lib/parameter-schema.ts` (schema/validation)
- To add a parameter: add to schema in `parameter-schema.ts` with Zod validation and default
- Deploy: `cd cdk && npm run deploy` or use `/deploy-cdk-stack` skill
