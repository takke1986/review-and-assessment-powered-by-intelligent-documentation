#!/bin/bash

set -e  # エラー発生時にスクリプトを停止

echo "=== RAPID デプロイスクリプト ==="

# 環境確認
if ! command -v docker &> /dev/null; then
  echo "Dockerがインストールされていません。macOSでのデプロイにはDockerが必要です。"
  exit 1
fi

if ! command -v aws &> /dev/null; then
  echo "AWS CLIがインストールされていません。"
  exit 1
fi

# AWS認証確認
echo "AWS認証情報の確認..."
aws sts get-caller-identity > /dev/null || { echo "AWS認証情報が設定されていません"; exit 1; }

# Dockerが起動しているか確認
if ! docker info &> /dev/null; then
  echo "Dockerが起動していません。起動してください。"
  exit 1
fi

# バックエンド準備
echo "バックエンドの準備..."
cd backend
npm ci
npm run prisma:generate


# ビルド
echo "バックエンドのビルド中..."
npm run build
cd ..

# CDKデプロイ
echo "CDKデプロイ開始..."
cd cdk
npm ci
npm run build
# npx を通してこのリポジトリの CDK CLI を使う。グローバルに入っている
# 古い cdk だと "Cloud assembly schema version mismatch" で止まり、
# しかもそれが最後まで気づきにくい
npx cdk deploy --all --require-approval never

# マイグレーション自動実行の確認（バックアップとして手動実行も可能）
echo "データベースマイグレーションの確認..."
echo "注: マイグレーションはCDK CustomResourceにより自動実行されています"
echo "自動マイグレーションが失敗した場合は以下のコマンドで手動実行可能:"
MIGRATION_COMMAND=$(aws cloudformation describe-stacks --stack-name RapidStack --query "Stacks[0].Outputs[?OutputKey=='DeployMigrationCommand'].OutputValue" --output text)
echo "$MIGRATION_COMMAND"

# マイグレーション完了確認のためしばらく待機
echo "マイグレーション完了を確認中..."
sleep 5

# フロントエンドURLとバックエンドAPIのURLを表示
FRONTEND_URL=$(aws cloudformation describe-stacks --stack-name RapidStack --query "Stacks[0].Outputs[?OutputKey=='FrontendURL'].OutputValue" --output text)
API_URL=$(aws cloudformation describe-stacks --stack-name RapidStack --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)

echo "デプロイ成功！"
echo "フロントエンドURL: $FRONTEND_URL"
echo "API URL: $API_URL"

# Docker停止（このスクリプトで起動した場合のみ）
if [ -n "$DOCKER_STARTED" ]; then
  echo "MySQLコンテナを停止しています..."
  cd ..
  docker-compose down -v
fi

echo "デプロイ完了！"
