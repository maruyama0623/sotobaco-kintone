# Render: タイトル要約・回答案・レポート中継API

問い合わせ明細（枝番1）の問い合わせ内容を ChatGPT で要約し、kintone の `title` に設定するための中継APIです。  
あわせて、AI回答案・サービス別レポート生成にも利用します。  
APIキーをブラウザに出さないために使います。

## 1. Render でデプロイ

1. Render の `New +` -> `Web Service`
2. このリポジトリを選択
3. 設定:
   - `Root Directory`: `render/title-proxy`
   - `Build Command`: `npm install`
   - `Start Command`: `npm start`
4. Environment Variables:
   - `OPENAI_API_KEY`: OpenAI APIキー
   - `OPENAI_MODEL`: `gpt-4o-mini`（任意）
   - `PROXY_TOKEN`: 任意の長い文字列（推奨）
   - `GUIDE_ROOT_URL`: 操作ガイドの起点URL（既定: `https://guide.sotobaco.com/portal/index.html`）
   - `GUIDE_CONTEXT_ENABLED`: `true` / `false`（既定: `true`）
   - `GUIDE_MAX_PAGES`: ガイド巡回の最大ページ数（既定: `24`）
   - `GUIDE_CACHE_TTL_MS`: ガイドキャッシュTTL（既定: `21600000` = 6時間）

## 2. 動作確認

- `GET /health` が `{ "ok": true }` を返すこと
- `POST /summarize-title` に `{ "text": "..." }` を送ると `{ "title": "..." }` が返ること
- `POST /draft-answer` に `{ "question": "...", "template": "...", "candidates": [] }` を送ると `{ "answer": "..." }` が返ること

## 3. kintone側設定

`src/app93-contact-list.js` の以下を設定:

- `TITLE_SUMMARY_ENDPOINT`: Render のURL + `/summarize-title`
- `TITLE_SUMMARY_PROXY_TOKEN`: `PROXY_TOKEN` と同じ値

例:

```js
const TITLE_SUMMARY_ENDPOINT = 'https://your-service.onrender.com/summarize-title';
const TITLE_SUMMARY_PROXY_TOKEN = 'xxxxxxxxxxxxxxxx';
```

## 注意

- 要約連携は「枝番1の問い合わせ内容 textarea からフォーカスが外れた時」に動きます。
- API失敗時は入力を止めず、タイトル自動設定だけスキップします。
- 回答案/レポートは操作ガイドを巡回取得して要点を参照します（キャッシュあり）。
