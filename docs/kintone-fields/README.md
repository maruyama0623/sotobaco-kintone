# Kintone Field Sync

kintone のアプリフィールド定義をローカルに保存するための手順です。

## 実行コマンド

- 全アプリ同期: `npm run fields:sync`
- 請求管理(74)のみ同期: `npm run fields:sync:74`
- 任意アプリのみ同期: `npm run fields:sync -- --app 90`

## 出力先

- 一覧: `docs/kintone-fields/index.json`
- 各アプリ: `docs/kintone-fields/app-<APP_ID>.json`

## 運用ルール

1. kintone でフィールドを追加/変更したら `npm run fields:sync` を実行
2. 変更差分を `git diff` で確認
3. 必要に応じてコミット
