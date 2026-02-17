import express from 'express';

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';
const GUIDE_ROOT_URL = process.env.GUIDE_ROOT_URL || 'https://guide.sotobaco.com/portal/index.html';
const GUIDE_CONTEXT_ENABLED = String(process.env.GUIDE_CONTEXT_ENABLED || 'true').toLowerCase() !== 'false';
const GUIDE_MAX_PAGES = Number(process.env.GUIDE_MAX_PAGES || 24);
const GUIDE_CACHE_TTL_MS = Number(process.env.GUIDE_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const GUIDE_FETCH_TIMEOUT_MS = Number(process.env.GUIDE_FETCH_TIMEOUT_MS || 12000);

const cleanInline = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const normalizeMultiline = (v) =>
  String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const unique = (arr) => [...new Set(arr)];
const stopWords = new Set([
  'です',
  'ます',
  'する',
  'いる',
  'ある',
  'こと',
  'ため',
  'よう',
  'ください',
  '確認',
  '設定',
  '操作',
  '画面',
  'ソトバコ',
  'ポータル',
  'kintone',
]);

const htmlEntityMap = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

const decodeHtmlEntities = (input) => {
  let s = String(input == null ? '' : input);
  s = s.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
    const code = parseInt(n, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  s = s.replace(/&([a-zA-Z0-9#]+);/g, (m, name) => (htmlEntityMap[name] ? htmlEntityMap[name] : m));
  return s;
};

const stripHtmlToText = (html) =>
  normalizeMultiline(
    decodeHtmlEntities(
      String(html == null ? '' : html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
    )
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
  );

const extractTitleFromHtml = (html, fallback) => {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return fallback;
  const title = cleanInline(decodeHtmlEntities(m[1]));
  return title || fallback;
};

const extractHrefLinks = (html, currentUrl) => {
  const links = [];
  const re = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const raw = m[1] || m[2] || m[3] || '';
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:')) continue;
    try {
      const resolved = new URL(raw, currentUrl);
      resolved.hash = '';
      resolved.search = '';
      links.push(resolved.href);
    } catch (_e) {
      // ignore invalid url
    }
  }
  return unique(links);
};

const tokenize = (s) => {
  const found = String(s == null ? '' : s)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._-]{1,}|[一-龯ぁ-んァ-ヶー]{2,}/g);
  if (!found) return [];
  return unique(found.filter((w) => !stopWords.has(w)));
};

const abortableFetchText = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GUIDE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

const guideCache = {
  pages: [],
  fetchedAt: 0,
  expiresAt: 0,
  lastError: '',
};

const isAllowedGuideUrl = (url) => {
  const root = new URL(GUIDE_ROOT_URL);
  const u = new URL(url);
  if (u.host !== root.host) return false;
  const rootDir = root.pathname.endsWith('/') ? root.pathname : root.pathname.replace(/[^/]*$/, '');
  if (!u.pathname.startsWith(rootDir)) return false;
  if (!/(\.html?$|\/$)/i.test(u.pathname)) return false;
  return true;
};

const crawlGuidePages = async () => {
  const startUrl = new URL(GUIDE_ROOT_URL).href;
  const visited = new Set();
  const queue = [startUrl];
  const pages = [];

  while (queue.length && pages.length < GUIDE_MAX_PAGES) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    if (!isAllowedGuideUrl(url)) continue;

    try {
      const html = await abortableFetchText(url);
      const title = extractTitleFromHtml(html, url);
      const text = stripHtmlToText(html);
      if (text.length > 80) {
        pages.push({
          url,
          title,
          text: text.slice(0, 12000),
        });
      }

      const links = extractHrefLinks(html, url)
        .filter((next) => !visited.has(next) && isAllowedGuideUrl(next))
        .slice(0, 60);
      links.forEach((next) => queue.push(next));
    } catch (_e) {
      // skip fetch failures and continue crawling
    }
  }
  return pages;
};

const getGuidePages = async () => {
  if (!GUIDE_CONTEXT_ENABLED) return [];
  const now = Date.now();
  if (guideCache.pages.length && guideCache.expiresAt > now) return guideCache.pages;
  try {
    const pages = await crawlGuidePages();
    guideCache.pages = pages;
    guideCache.fetchedAt = now;
    guideCache.expiresAt = now + GUIDE_CACHE_TTL_MS;
    guideCache.lastError = '';
    return pages;
  } catch (err) {
    guideCache.lastError = err && err.message ? err.message : 'guide crawl failed';
    guideCache.fetchedAt = now;
    guideCache.expiresAt = now + Math.min(5 * 60 * 1000, GUIDE_CACHE_TTL_MS);
    return guideCache.pages || [];
  }
};

const pickGuideSnippet = (page, tokens, limit = 540) => {
  const src = normalizeMultiline(page.text || '');
  if (!src) return '';
  if (!tokens.length) return src.slice(0, limit);

  const lower = src.toLowerCase();
  let hit = -1;
  for (const tk of tokens) {
    const idx = lower.indexOf(tk.toLowerCase());
    if (idx >= 0 && (hit < 0 || idx < hit)) {
      hit = idx;
    }
  }
  if (hit < 0) return src.slice(0, limit);

  let start = Math.max(0, hit - 220);
  let end = Math.min(src.length, start + limit);
  const prevNl = src.lastIndexOf('\n', start);
  if (prevNl >= 0) start = prevNl + 1;
  const nextNl = src.indexOf('\n', end);
  if (nextNl >= 0) end = nextNl;
  return src.slice(start, end).trim();
};

const buildGuideContext = async ({ question, candidates }) => {
  if (!GUIDE_CONTEXT_ENABLED) return '';
  const pages = await getGuidePages();
  if (!pages.length) return '';

  const seed = [
    normalizeMultiline(question),
    ...(Array.isArray(candidates) ? candidates : []).map((c) => `${normalizeMultiline(c.question)}\n${normalizeMultiline(c.answer)}`),
  ].join('\n');
  const tokens = tokenize(seed).slice(0, 24);

  const scored = pages
    .map((p) => {
      const t = `${p.title}\n${p.text}`.toLowerCase();
      let score = 0;
      tokens.forEach((tk) => {
        if (t.includes(tk)) score += p.title.toLowerCase().includes(tk) ? 3 : 1;
      });
      return { page: p, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected = scored.some((x) => x.score > 0)
    ? scored.filter((x) => x.score > 0).slice(0, 4)
    : scored.slice(0, 2);

  return selected
    .map((x, idx) => {
      const snippet = pickGuideSnippet(x.page, tokens);
      return `[ガイド${idx + 1}] ${x.page.title}\nURL: ${x.page.url}\n抜粋:\n${snippet}`;
    })
    .join('\n\n');
};

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    guide: {
      enabled: GUIDE_CONTEXT_ENABLED,
      cachedPages: guideCache.pages.length,
      fetchedAt: guideCache.fetchedAt || null,
      expiresAt: guideCache.expiresAt || null,
      lastError: guideCache.lastError || '',
      rootUrl: GUIDE_ROOT_URL,
    },
  });
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

    const source = cleanInline(req.body && req.body.text);
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
    const title = cleanInline(json?.choices?.[0]?.message?.content || '').replace(/^["「]|["」]$/g, '');
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

    const question = normalizeMultiline(req.body && req.body.question);
    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const template = normalizeMultiline(req.body && req.body.template) || '';
    const candidates = Array.isArray(req.body && req.body.candidates) ? req.body.candidates.slice(0, 8) : [];
    const normalizedCandidates = candidates.map((c) => ({
      question: normalizeMultiline(c && c.question),
      answer: normalizeMultiline(c && c.answer),
    }));
    const referenceText = candidates
      .map((c, i) => `#${i + 1}\n質問: ${normalizeMultiline(c && c.question)}\n回答: ${normalizeMultiline(c && c.answer)}`)
      .join('\n\n');
    const guideContext = await buildGuideContext({ question, candidates: normalizedCandidates });

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
              'あなたはカスタマーサポート文書作成アシスタントです。入力された質問・参考回答・操作ガイド抜粋を使い、丁寧で実務的な文書を1通作成します。最優先は操作ガイドの内容との整合です。ガイドに根拠がある手順や設定名は具体的に記載し、根拠がない箇所は断定しないでください。日本語で出力し、余計な注釈は書かずテンプレート構成に沿って返してください。',
          },
          {
            role: 'user',
            content: `以下の質問に対する回答文（またはレポート）を作成してください。\n\n質問:\n${question}\n\n参考回答（類似）:\n${referenceText || 'なし'}\n\n操作ガイド抜粋:\n${guideContext || 'ガイド情報を取得できませんでした。一般的な注意を添えて回答してください。'}\n\nテンプレート:\n${template}\n\n要件:\n- テンプレートの文体・構成を維持する\n- ガイド内容と矛盾しないようにする\n- 「> 質問内容」には質問を引用する（回答文の場合）\n- 回答本文は質問に合わせて具体化する\n- 参考回答をそのままコピペせず、今回の質問向けに調整する`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ error: 'OpenAI request failed', detail: body });
    }

    const json = await response.json();
    const answer = normalizeMultiline(json?.choices?.[0]?.message?.content || '');
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
