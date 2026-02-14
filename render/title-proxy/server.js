import express from 'express';

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/summarize-title', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });
    }

    if (PROXY_TOKEN) {
      const token = req.header('x-proxy-token') || '';
      if (token !== PROXY_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const source = clean(req.body && req.body.text);
    if (!source) {
      return res.status(400).json({ error: 'text is required' });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content:
              'あなたは業務システムのタイトル生成アシスタントです。入力文から、日本語タイトルを1行で作成してください。最重要: 「何をしたいか/何ができないか」が一読で分かる表現を優先し、「〜について」「〜の件」は原則使わない。例: 「CSV取り込みが完了しない」「請求書PDFを再発行できない」。記号は最小限、冗長な敬語は不要、20〜40文字程度。',
          },
          {
            role: 'user',
            content: source,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ error: 'OpenAI request failed', detail: body });
    }

    const json = await response.json();
    const title = clean(json?.choices?.[0]?.message?.content || '').replace(/^["「]|["」]$/g, '');
    if (!title) {
      return res.status(502).json({ error: 'Empty summary result' });
    }

    res.json({ title });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : 'unknown error' });
  }
});

app.post('/draft-answer', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });
    }

    if (PROXY_TOKEN) {
      const token = req.header('x-proxy-token') || '';
      if (token !== PROXY_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const question = clean(req.body && req.body.question);
    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const template = clean(req.body && req.body.template) || '';
    const candidates = Array.isArray(req.body && req.body.candidates) ? req.body.candidates.slice(0, 8) : [];
    const referenceText = candidates
      .map((c, i) => `#${i + 1}\n質問: ${clean(c.question)}\n回答: ${clean(c.answer)}`)
      .join('\n\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content:
              'あなたはカスタマーサポートの返信文作成アシスタントです。入力された質問と参考回答から、丁寧で実務的な回答文を1通作成します。日本語で出力し、不要な注釈は書かず、テンプレート構成に沿って返してください。',
          },
          {
            role: 'user',
            content: `以下の質問に回答文を作成してください。\n\n質問:\n${question}\n\n参考回答（類似）:\n${referenceText || 'なし'}\n\nテンプレート:\n${template}\n\n要件:\n- テンプレートの文体・構成を維持する\n- 「> 質問内容」には質問を引用する\n- 「回答内容」は質問に合わせて具体化する\n- 参考回答をそのままコピペせず、今回の質問向けに調整する`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ error: 'OpenAI request failed', detail: body });
    }

    const json = await response.json();
    const answer = clean(json?.choices?.[0]?.message?.content || '');
    if (!answer) {
      return res.status(502).json({ error: 'Empty draft result' });
    }

    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : 'unknown error' });
  }
});

app.listen(PORT, () => {
  console.log(`title-summary-proxy listening on :${PORT}`);
});
