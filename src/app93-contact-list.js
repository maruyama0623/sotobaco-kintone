(() => {
  'use strict';

  const APP_ID = 93;
  const DETAIL_APP_ID = 94;
  const CLIENT_APP_ID = 69;
  const SPACE_CODE = 'contact_list';
  const QUESTION_ID = 'question_id';
  const TITLE = 'title';
  const QUESTION_DATE = 'question_date';
  const STATUS = 'status';
  const QUESTION_DETAIL = 'question_detail';
  const ANSWER_DATE = 'answer_date';
  const ANSWER_ASSOCIATE = 'answer_associate';
  const ANSWER_DETAIL = 'answer_detail';
  const BRANCH_NUMBER = 'branch_number';
  const CLIENT_NO = 'client_no';
  const CLIENT_NAME = 'client_name';
  const CREATE_TIME = '作成日時';
  const TITLE_SUMMARY_ENDPOINT = 'https://sotobaco-kintone.onrender.com/summarize-title';
  const ANSWER_DRAFT_ENDPOINT = 'https://sotobaco-kintone.onrender.com/draft-answer';
  const TITLE_SUMMARY_PROXY_TOKEN = 'sbk_20260214_proxy_7f9d2a6c1e8b4d03a75c91f2e6b8ad44';
  const ANSWER_TEMPLATE = `早速ではございますが、お問い合わせいただきました件について回答いたします。

> 質問内容

回答内容

ご質問の回答は以上となります。
他にご不明点やお困り事等がございましたら、お気軽にお問い合わせくださいませ。
また、ソトバコポータルには無料でご利用いただけるフリープランもございますので、
ぜひ一度お試しいただけますと幸いでございます。

引き続き何卒よろしくお願い申し上げます。`;

  const MIN_SEQ_DIGITS = 3;
  const STYLE_ID = 'app93-contact-list-style';
  const WRAP_ID = 'app93-contact-list-wrap';
  const userMap = new Map();
  let usersLoaded = false;

  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const text = (v) => String(v == null ? '' : v);
  const pad = (n, digits) => String(n).padStart(digits, '0');
  const h = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const decodeHtmlEntities = (value) => {
    const el = document.createElement('textarea');
    el.innerHTML = text(value);
    return el.value;
  };
  const summaryState = {
    seq: 0,
    lastSource: '',
  };

  const getJstYmd = (d = new Date()) => {
    const f = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = f.formatToParts(d).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    return `${parts.year}${parts.month}${parts.day}`;
  };

  const normalizeDateYmd = (v) => {
    const s = String(v || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '');
    return '';
  };

  const toDateInput = (ymd) => {
    if (!/^\d{8}$/.test(ymd || '')) return '';
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  };

  const cleanSummaryText = (v) => text(v).replace(/\s+/g, ' ').trim();

  const canUseSummaryApi = () =>
    /^https?:\/\//.test(TITLE_SUMMARY_ENDPOINT) &&
    !TITLE_SUMMARY_ENDPOINT.includes('YOUR-RENDER-SERVICE');

  const summarizeTitle = async (questionDetail) => {
    if (!canUseSummaryApi()) return '';
    const source = cleanSummaryText(questionDetail);
    if (!source) return '';

    const headers = {
      'Content-Type': 'application/json',
    };
    if (TITLE_SUMMARY_PROXY_TOKEN) headers['x-proxy-token'] = TITLE_SUMMARY_PROXY_TOKEN;

    const body = JSON.stringify({ text: source });
    const [resBody, status] = await kintone.proxy(TITLE_SUMMARY_ENDPOINT, 'POST', headers, body);
    if (Number(status) < 200 || Number(status) >= 300) {
      throw new Error('タイトル要約APIの呼び出しに失敗しました。');
    }
    const parsed = typeof resBody === 'string' ? JSON.parse(resBody) : resBody;
    return cleanSummaryText(parsed && parsed.title);
  };

  const applyTitleSummary = async (rawQuestionDetail) => {
    const source = cleanSummaryText(rawQuestionDetail);
    if (!source) return;
    if (source === summaryState.lastSource) return;

    const seq = ++summaryState.seq;
    try {
      const title = await summarizeTitle(source);
      if (!title) return;
      if (seq !== summaryState.seq) return;
      const state = kintone.app.record.get();
      if (!state || !state.record || !state.record[TITLE]) return;
      state.record[TITLE].value = title;
      kintone.app.record.set(state);
      summaryState.lastSource = source;
    } catch (err) {
      // Keep UX non-blocking for input flow.
      console.warn('[app93-contact-list] title summarize failed', err);
    }
  };

  const addUsers = (users) => {
    (users || []).forEach((u) => {
      const code = text(u.code).trim();
      if (!code) return;
      const name = text(u.name || u.code).trim();
      userMap.set(code, { code, name });
    });
  };

  const listUsers = () => Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const callUsersApi = async (params) => {
    try {
      return await kintone.api(kintone.api.url('/v1/users', true), 'GET', params);
    } catch (e) {
      return kintone.api(kintone.api.url('/v1/users.json', true), 'GET', params);
    }
  };

  const loadUsers = async () => {
    if (usersLoaded) return;

    const login = kintone.getLoginUser ? kintone.getLoginUser() : null;
    if (login && login.code) addUsers([{ code: login.code, name: login.name }]);

    try {
      const limit = 100;
      for (let offset = 0; offset <= 5000; offset += limit) {
        const res = await callUsersApi({ size: limit, offset });
        const users = Array.isArray(res?.users) ? res.users : [];
        addUsers(users.map((u) => ({ code: u.code, name: u.name })));
        if (users.length < limit) break;
      }
    } catch (e) {
      console.warn('[app93-contact-list] users api unavailable', e);
    } finally {
      usersLoaded = true;
    }
  };

  const userDisplay = (code) => {
    const c = text(code).trim();
    if (!c) return '';
    const u = userMap.get(c);
    return u ? `${u.name} (${u.code})` : c;
  };

  const resolveUserCode = (raw) => {
    const s = text(raw).trim();
    if (!s) return '';
    if (userMap.has(s)) return s;

    const m = s.match(/\(([^()]+)\)\s*$/);
    if (m && userMap.has(m[1])) return m[1];

    const byName = listUsers().filter((u) => u.name === s);
    if (byName.length === 1) return byName[0].code;

    return '';
  };

  const parseClientNoNumber = (v) => {
    const m = text(v).trim().match(/^C(\d+)$/);
    return m ? Number(m[1]) : null;
  };

  const toClientNo = (num) => `C${pad(num, 5)}`;

  const existsClientNo = async (clientNo) => {
    const res = await fetchRecords(CLIENT_APP_ID, `${CLIENT_NO} = "${esc(clientNo)}" limit 1`, [CLIENT_NO]);
    return (res.records || []).length > 0;
  };

  const getNextClientNo = async () => {
    const res = await fetchRecords(
      CLIENT_APP_ID,
      `${CLIENT_NO} >= "C" and ${CLIENT_NO} < "D" order by ${CLIENT_NO} desc limit 200`,
      [CLIENT_NO]
    );
    const list = res.records || [];
    let max = 0;
    for (const r of list) {
      const n = parseClientNoNumber(r?.[CLIENT_NO]?.value);
      if (n !== null) {
        max = Math.max(max, n);
        break;
      }
    }
    return toClientNo(max + 1);
  };

  const pickAvailableClientNo = async () => {
    const base = parseClientNoNumber(await getNextClientNo()) || 1;
    for (let i = 0; i < 1000; i += 1) {
      const candidate = toClientNo(base + i);
      if (!(await existsClientNo(candidate))) return candidate;
    }
    throw new Error('クライアントCDの採番に失敗しました。');
  };

  const createClientQuick = async (clientName) => {
    const name = text(clientName).trim();
    if (!name) throw new Error('クライアント名を入力してください。');
    const clientNo = await pickAvailableClientNo();
    const payload = {
      app: CLIENT_APP_ID,
      record: {
        [CLIENT_NO]: { value: clientNo },
        [CLIENT_NAME]: { value: name },
      },
    };
    await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', payload);
    return { clientNo, clientName: name };
  };

  const fetchRecords = async (app, query, fields) =>
    kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app,
      query,
      fields,
    });

  const existsQuestionId = async (id, excludeRecordId = null) => {
    const q = [`${QUESTION_ID} = "${esc(id)}"`];
    if (excludeRecordId) q.push(`$id != "${excludeRecordId}"`);
    const res = await fetchRecords(APP_ID, `${q.join(' and ')} limit 1`, [QUESTION_ID]);
    return (res.records || []).length > 0;
  };

  const getQuestionIdDate = (record, isCreate) => {
    const fromQuestionDate = normalizeDateYmd(record?.[QUESTION_DATE]?.value);
    if (fromQuestionDate) return fromQuestionDate;
    if (!isCreate) {
      const created = text(record?.[CREATE_TIME]?.value);
      const m = created.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}${m[2]}${m[3]}`;
    }
    return getJstYmd();
  };

  const getNextQuestionId = async (baseDate) => {
    const res = await fetchRecords(
      APP_ID,
      `${QUESTION_ID} like "${esc(baseDate)}-" order by ${QUESTION_ID} desc limit 1`,
      [QUESTION_ID]
    );
    const current = text(res.records?.[0]?.[QUESTION_ID]?.value);
    const m = current.match(new RegExp(`^${baseDate}-(\\d+)$`));
    const seq = m ? Number(m[1]) : 0;
    return `${baseDate}-${pad(seq + 1, MIN_SEQ_DIGITS)}`;
  };

  const pickAvailableQuestionId = async (baseDate, excludeRecordId = null) => {
    let start = 1;
    const latest = await getNextQuestionId(baseDate);
    const m = latest.match(/-(\d+)$/);
    if (m) start = Number(m[1]);

    for (let i = 0; i < 1000; i += 1) {
      const id = `${baseDate}-${pad(start + i, MIN_SEQ_DIGITS)}`;
      if (!(await existsQuestionId(id, excludeRecordId))) return id;
    }
    throw new Error('問い合わせIDの採番候補が見つかりませんでした。');
  };

  const ensureQuestionId = async ({ record, isCreate, recordId }) => {
    const current = text(record?.[QUESTION_ID]?.value).trim();
    let needsAssign = !current;
    if (isCreate && current) needsAssign = await existsQuestionId(current);
    if (!needsAssign) return current;
    const baseDate = getQuestionIdDate(record, isCreate);
    return pickAvailableQuestionId(baseDate, recordId ? String(recordId) : null);
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${WRAP_ID} {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #fbfdff 0%, #f5f9ff 100%);
        border: 1px solid #dbe7f3;
        border-radius: 12px;
        padding: 14px;
      }
      #${WRAP_ID} .cl93-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      #${WRAP_ID} .cl93-title {
        font-size: 14px;
        font-weight: 700;
        color: #1f2e3b;
      }
      #${WRAP_ID} .cl93-sub {
        font-size: 12px;
        color: #607080;
      }
      #${WRAP_ID} .cl93-btn {
        border: 0;
        background: #1768cc;
        color: #fff;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        cursor: pointer;
      }
      #${WRAP_ID} .cl93-btn-sub {
        border: 1px solid #cad6e2;
        background: #fff;
        color: #34485a;
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      #${WRAP_ID} .cl93-btn-ai {
        border: 1px solid #5f6ad4;
        background: #f5f6ff;
        color: #3943a7;
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      .cl93-client-btn {
        border: 0;
        background: #0d8b66;
        color: #fff;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        cursor: pointer;
      }
      .cl93-client-btn-link {
        border: 1px solid #0d8b66;
        background: #fff;
        color: #0d8b66;
        border-radius: 14px;
        padding: 4px 10px;
        font-size: 11px;
        line-height: 1.4;
        cursor: pointer;
        margin-left: 8px;
        display: inline-block;
        vertical-align: middle;
      }
      #${WRAP_ID} .cl93-list {
        display: grid;
        gap: 12px;
      }
      #${WRAP_ID} .cl93-row {
        background: #fff;
        border: 1px solid #d8e3ef;
        border-radius: 10px;
        padding: 10px;
      }
      #${WRAP_ID} .cl93-row-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      #${WRAP_ID} .cl93-branch {
        font-size: 12px;
        color: #5f7182;
        font-weight: 700;
      }
      #${WRAP_ID} .cl93-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      #${WRAP_ID} .cl93-item label {
        display: block;
        font-size: 11px;
        color: #617486;
        margin-bottom: 4px;
      }
      #${WRAP_ID} .cl93-item input,
      #${WRAP_ID} .cl93-item select,
      #${WRAP_ID} .cl93-item textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #ccd8e4;
        border-radius: 7px;
        padding: 8px 10px;
        font-size: 13px;
        font-family: inherit;
      }
      #${WRAP_ID} input[data-k="answer_associate_input"] {
        width: 350px;
        max-width: 100%;
      }
      #${WRAP_ID} .cl93-item textarea {
        min-height: 300px;
        resize: vertical;
      }
      #${WRAP_ID} .cl93-user-wrap { position: relative; }
      #${WRAP_ID} .cl93-user-menu {
        position: absolute;
        left: 0;
        right: 0;
        top: calc(100% + 4px);
        z-index: 40;
        border: 1px solid #ccd8e4;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 6px 20px rgba(10, 20, 30, 0.14);
        max-height: 220px;
        overflow: auto;
        display: none;
      }
      #${WRAP_ID} .cl93-user-item {
        padding: 8px 10px;
        font-size: 12px;
        color: #223;
        cursor: pointer;
      }
      #${WRAP_ID} .cl93-user-item:hover { background: #f2f7ff; }
      #${WRAP_ID} .cl93-user-empty {
        padding: 8px 10px;
        font-size: 12px;
        color: #7a8794;
      }
      #${WRAP_ID} .cl93-full { grid-column: 1 / -1; }
      #${WRAP_ID} .cl93-empty {
        border: 1px dashed #c6d8eb;
        border-radius: 10px;
        padding: 14px;
        color: #5f7182;
        font-size: 12px;
        background: #fcfdff;
      }
      #${WRAP_ID} .cl93-ro-list {
        display: grid;
        gap: 10px;
      }
      #${WRAP_ID} .cl93-ro-card {
        background: #fff;
        border: 1px solid #d8e3ef;
        border-radius: 10px;
        padding: 10px;
      }
      #${WRAP_ID} .cl93-ro-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px 12px;
      }
      #${WRAP_ID} .cl93-ro-item dt {
        margin: 0 0 2px;
        font-size: 11px;
        color: #6a7b8b;
      }
      #${WRAP_ID} .cl93-ro-item dd {
        margin: 0;
        font-size: 13px;
        color: #1f2e3b;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      #${WRAP_ID} .cl93-ro-full {
        grid-column: 1 / -1;
      }
      #${WRAP_ID} .cl93-ro-wide {
        grid-column: span 2;
      }
      #${WRAP_ID} .cl93-ro-no-break dd {
        white-space: nowrap;
        overflow-wrap: normal;
        word-break: keep-all;
      }
      @media (max-width: 900px) {
        #${WRAP_ID} .cl93-grid, #${WRAP_ID} .cl93-ro-grid { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  };

  const getWrapper = () => document.getElementById(WRAP_ID);

  const renderRow = (row, idx) => {
    const branch = idx + 1;
    return `
      <section class="cl93-row" data-row>
        <div class="cl93-row-top">
          <div class="cl93-branch">枝番 ${branch}</div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="cl93-btn-ai" data-action="draft-answer">AI回答案</button>
            <button type="button" class="cl93-btn-sub" data-action="remove">削除</button>
          </div>
        </div>
        <div class="cl93-grid">
          <div class="cl93-item">
            <label>問い合わせ日付</label>
            <input type="date" data-k="question_date" value="${text(row.question_date || '')}" />
          </div>
          <div class="cl93-item">
            <label>ステータス</label>
            <select data-k="status">
              <option value="未回答" ${row.status === '未回答' ? 'selected' : ''}>未回答</option>
              <option value="要調査" ${row.status === '要調査' ? 'selected' : ''}>要調査</option>
              <option value="回答済" ${row.status === '回答済' ? 'selected' : ''}>回答済</option>
            </select>
          </div>
          <div class="cl93-item cl93-full">
            <label>問い合わせ内容</label>
            <textarea data-k="question_detail">${text(row.question_detail || '')}</textarea>
          </div>
          <div class="cl93-item">
            <label>回答日付</label>
            <input type="date" data-k="answer_date" value="${text(row.answer_date || '')}" />
          </div>
          <div class="cl93-item">
            <label>回答者</label>
            <div class="cl93-user-wrap">
              <input
                type="text"
                data-k="answer_associate_input"
                value="${h(row.answer_associate_input || userDisplay(row.answer_associate_code || ''))}"
                placeholder="ユーザー名またはコードで検索"
                autocomplete="off"
              />
              <input type="hidden" data-k="answer_associate_code" value="${h(row.answer_associate_code || '')}" />
              <div class="cl93-user-menu" data-k="answer_associate_menu"></div>
            </div>
          </div>
          <div class="cl93-item cl93-full">
            <label>回答内容</label>
            <textarea data-k="answer_detail">${text(row.answer_detail || '')}</textarea>
          </div>
        </div>
      </section>
    `;
  };

  const renderRows = (rows) => {
    const wrap = getWrapper();
    if (!wrap) return;
    const list = wrap.querySelector('.cl93-list');
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = '<div class="cl93-empty">明細がありません。右上の「+ 明細を追加」で追加してください。</div>';
      return;
    }
    list.innerHTML = rows.map((r, i) => renderRow(r, i)).join('');
  };

  const collectRows = () => {
    const wrap = getWrapper();
    if (!wrap) return [];
    const sections = Array.from(wrap.querySelectorAll('[data-row]'));
    return sections.map((sec) => ({
      question_date: text(sec.querySelector('[data-k="question_date"]')?.value).trim(),
      status: text(sec.querySelector('[data-k="status"]')?.value).trim() || '未回答',
      question_detail: text(sec.querySelector('[data-k="question_detail"]')?.value).trim(),
      answer_date: text(sec.querySelector('[data-k="answer_date"]')?.value).trim(),
      answer_associate_input: text(sec.querySelector('[data-k="answer_associate_input"]')?.value).trim(),
      answer_associate_code:
        text(sec.querySelector('[data-k="answer_associate_code"]')?.value).trim() ||
        resolveUserCode(sec.querySelector('[data-k="answer_associate_input"]')?.value),
      answer_detail: text(sec.querySelector('[data-k="answer_detail"]')?.value).trim(),
    }));
  };

  const parseAssociateCodes = (code) => {
    const c = text(code).trim();
    return c ? [{ code: c }] : [];
  };

  const validateRows = (rows) => {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (!r.question_date) {
        throw new Error(`明細${i + 1}: 問い合わせ日付を入力してください。`);
      }
      if (!r.question_detail) {
        throw new Error(`明細${i + 1}: 問い合わせ内容を入力してください。`);
      }
      if (r.answer_associate_input && !r.answer_associate_code) {
        throw new Error(`明細${i + 1}: 回答者は候補から選択してください。`);
      }
    }
  };

  const fetchDetailRows = async (questionId) => {
    if (!questionId) return [];
    const query = `${QUESTION_ID} = "${esc(questionId)}" order by ${BRANCH_NUMBER} asc limit 500`;
    const fields = [QUESTION_DATE, STATUS, QUESTION_DETAIL, ANSWER_DATE, ANSWER_ASSOCIATE, ANSWER_DETAIL, BRANCH_NUMBER];
    const res = await fetchRecords(DETAIL_APP_ID, query, fields);
    const records = res.records || [];
    return records.map((rec) => ({
      question_date: text(rec?.[QUESTION_DATE]?.value),
      status: text(rec?.[STATUS]?.value) || '未回答',
      question_detail: decodeHtmlEntities(text(rec?.[QUESTION_DETAIL]?.value).replace(/<[^>]*>/g, ' ')).trim(),
      answer_date: text(rec?.[ANSWER_DATE]?.value),
      answer_associate_code:
        Array.isArray(rec?.[ANSWER_ASSOCIATE]?.value) && rec[ANSWER_ASSOCIATE].value.length
          ? text(rec[ANSWER_ASSOCIATE].value[0].code)
          : '',
      answer_associate_input:
        Array.isArray(rec?.[ANSWER_ASSOCIATE]?.value) && rec[ANSWER_ASSOCIATE].value.length
          ? text(rec[ANSWER_ASSOCIATE].value[0].code)
          : '',
      answer_detail: decodeHtmlEntities(text(rec?.[ANSWER_DETAIL]?.value).replace(/<[^>]*>/g, ' ')).trim(),
    }));
  };

  const fetchDetailIds = async (questionId) => {
    if (!questionId) return [];
    const ids = [];
    const limit = 500;
    for (let offset = 0; offset <= 5000; offset += limit) {
      const res = await fetchRecords(
        DETAIL_APP_ID,
        `${QUESTION_ID} = "${esc(questionId)}" order by $id asc limit ${limit} offset ${offset}`,
        ['$id']
      );
      const list = res.records || [];
      ids.push(...list.map((r) => Number(r.$id.value)));
      if (list.length < limit) break;
    }
    return ids;
  };

  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const replaceDetails = async (questionId, rows) => {
    const ids = await fetchDetailIds(questionId);
    for (const group of chunk(ids, 100)) {
      await kintone.api(kintone.api.url('/k/v1/records', true), 'DELETE', {
        app: DETAIL_APP_ID,
        ids: group,
      });
    }

    if (!rows.length) return;

    const records = rows.map((r, idx) => ({
      [QUESTION_ID]: { value: questionId },
      [BRANCH_NUMBER]: { value: String(idx + 1) },
      [QUESTION_DATE]: { value: r.question_date },
      [STATUS]: { value: r.status || '未回答' },
      [QUESTION_DETAIL]: { value: r.question_detail || '' },
      [ANSWER_DATE]: { value: r.answer_date || '' },
      [ANSWER_ASSOCIATE]: { value: parseAssociateCodes(r.answer_associate_code) },
      [ANSWER_DETAIL]: { value: r.answer_detail || '' },
    }));

    for (const group of chunk(records, 100)) {
      await kintone.api(kintone.api.url('/k/v1/records', true), 'POST', {
        app: DETAIL_APP_ID,
        records: group,
      });
    }
  };

  const splitKeywords = (s) =>
    text(s)
      .toLowerCase()
      .split(/[ 　\n\r\t、。,.!！?？:：;；()（）\[\]【】「」"']/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2)
      .slice(0, 20);

  const scoreByKeywords = (question, target) => {
    const keys = splitKeywords(question);
    if (!keys.length) return 0;
    const t = text(target).toLowerCase();
    let score = 0;
    keys.forEach((k) => {
      if (t.includes(k)) score += 1;
    });
    return score;
  };

  const fetchAnswerCandidates = async (questionText) => {
    const res = await fetchRecords(
      DETAIL_APP_ID,
      `${ANSWER_DETAIL} != "" order by 更新日時 desc limit 200`,
      [QUESTION_DETAIL, ANSWER_DETAIL]
    );
    const records = res.records || [];
    const candidates = records
      .map((r) => ({
        question: decodeHtmlEntities(text(r?.[QUESTION_DETAIL]?.value).replace(/<[^>]*>/g, ' ')).trim(),
        answer: decodeHtmlEntities(text(r?.[ANSWER_DETAIL]?.value).replace(/<[^>]*>/g, ' ')).trim(),
      }))
      .filter((x) => x.question && x.answer)
      .map((x) => ({
        ...x,
        score: scoreByKeywords(questionText, x.question),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ question, answer }) => ({ question, answer }));
    return candidates;
  };

  const requestDraftAnswer = async ({ question, candidates }) => {
    const headers = { 'Content-Type': 'application/json' };
    if (TITLE_SUMMARY_PROXY_TOKEN) headers['x-proxy-token'] = TITLE_SUMMARY_PROXY_TOKEN;
    const body = JSON.stringify({
      question,
      candidates,
      template: ANSWER_TEMPLATE,
    });
    const [resBody, status] = await kintone.proxy(ANSWER_DRAFT_ENDPOINT, 'POST', headers, body);
    if (Number(status) < 200 || Number(status) >= 300) {
      throw new Error('回答案生成APIの呼び出しに失敗しました。');
    }
    const parsed = typeof resBody === 'string' ? JSON.parse(resBody) : resBody;
    const draft = text(parsed && parsed.answer).trim();
    if (!draft) throw new Error('回答案が生成されませんでした。');
    return draft;
  };

  const deleteDetailsByQuestionId = async (questionId) => {
    const qid = text(questionId).trim();
    if (!qid) return;
    const ids = await fetchDetailIds(qid);
    for (const group of chunk(ids, 100)) {
      await kintone.api(kintone.api.url('/k/v1/records', true), 'DELETE', {
        app: DETAIL_APP_ID,
        ids: group,
      });
    }
  };

  const filterUsers = (keyword) => {
    const q = text(keyword).trim().toLowerCase();
    const users = listUsers();
    if (!q) return users.slice(0, 60);
    return users
      .filter((u) => u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q))
      .slice(0, 60);
  };

  const closeMenus = () => {
    const wrap = getWrapper();
    if (!wrap) return;
    wrap.querySelectorAll('[data-k="answer_associate_menu"]').forEach((menu) => {
      menu.style.display = 'none';
    });
  };

  const openMenuForInput = (input) => {
    const row = input.closest('[data-row]');
    if (!row) return;
    const menu = row.querySelector('[data-k="answer_associate_menu"]');
    const hidden = row.querySelector('[data-k="answer_associate_code"]');
    if (!menu || !hidden) return;

    const candidates = filterUsers(input.value);
    if (!candidates.length) {
      menu.innerHTML = '<div class="cl93-user-empty">候補がありません</div>';
    } else {
      menu.innerHTML = candidates
        .map(
          (u) =>
            `<div class="cl93-user-item" data-action="pick-user" data-code="${h(u.code)}" data-name="${h(
              u.name
            )}">${h(`${u.name} (${u.code})`)}</div>`
        )
        .join('');
    }
    menu.style.display = 'block';

    const resolved = resolveUserCode(input.value);
    hidden.value = resolved || '';
  };

  const mount = async (event) => {
    if (kintone.app.getId() !== APP_ID) return;

    ensureStyle();
    const root =
      kintone.app.record.getSpaceElement(SPACE_CODE) ||
      kintone.app.record.getHeaderMenuSpaceElement();
    if (!root) return;

    root.innerHTML = `
      <section id="${WRAP_ID}">
        <div class="cl93-head">
          <div>
            <div class="cl93-title">問い合わせ明細（アプリ94）</div>
            <div class="cl93-sub">この画面で編集した内容は、問い合わせ管理の保存時に明細アプリへ保存されます。</div>
          </div>
          <button type="button" class="cl93-btn" data-action="add">+ 明細を追加</button>
        </div>
        <div class="cl93-list"></div>
      </section>
    `;

    let rows = [];
    await loadUsers();
    if (event.type === 'app.record.edit.show') {
      const qid = text(event.record?.[QUESTION_ID]?.value).trim();
      rows = await fetchDetailRows(qid);
      const users = [];
      rows.forEach((r) => {
        if (r.answer_associate_code) users.push({ code: r.answer_associate_code, name: r.answer_associate_code });
      });
      addUsers(users);
      rows = rows.map((r) => ({
        ...r,
        answer_associate_input: userDisplay(r.answer_associate_code),
      }));
    }
    renderRows(rows);

    const wrap = getWrapper();
    if (!wrap) return;

    wrap.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.dataset.action === 'add') {
        const current = collectRows();
        current.push({
          question_date: text(kintone.app.record.get().record?.[QUESTION_DATE]?.value),
          status: '未回答',
          question_detail: '',
          answer_date: '',
          answer_associate_code: '',
          answer_associate_input: '',
          answer_detail: '',
        });
        renderRows(current);
      }

      if (target.dataset.action === 'remove') {
        const rowEl = target.closest('[data-row]');
        if (!rowEl) return;
        const ok = window.confirm('この明細行を削除します。よろしいですか？');
        if (!ok) return;
        rowEl.remove();
        const current = collectRows();
        renderRows(current);
      }

      if (target.dataset.action === 'pick-user') {
        const code = text(target.dataset.code).trim();
        const name = text(target.dataset.name).trim();
        const row = target.closest('[data-row]');
        if (!row) return;
        const input = row.querySelector('[data-k="answer_associate_input"]');
        const hidden = row.querySelector('[data-k="answer_associate_code"]');
        const menu = row.querySelector('[data-k="answer_associate_menu"]');
        if (!input || !hidden || !menu) return;
        input.value = `${name} (${code})`;
        hidden.value = code;
        menu.style.display = 'none';
      }

      if (target.dataset.action === 'draft-answer') {
        const row = target.closest('[data-row]');
        if (!row) return;
        const q = row.querySelector('[data-k="question_detail"]');
        const a = row.querySelector('[data-k="answer_detail"]');
        if (!(q instanceof HTMLTextAreaElement) || !(a instanceof HTMLTextAreaElement)) return;
        const question = text(q.value).trim();
        if (!question) {
          window.alert('先に「問い合わせ内容」を入力してください。');
          return;
        }
        target.setAttribute('disabled', 'true');
        (async () => {
          try {
            const candidates = await fetchAnswerCandidates(question);
            const draft = await requestDraftAnswer({ question, candidates });
            a.value = draft;
          } catch (err) {
            window.alert(err && err.message ? err.message : '回答案の生成に失敗しました。');
          } finally {
            target.removeAttribute('disabled');
          }
        })();
      }
    });

    wrap.addEventListener('input', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.k !== 'answer_associate_input') return;
      openMenuForInput(target);
    });

    wrap.addEventListener('focusout', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (target.dataset.k !== 'question_detail') return;
      const row = target.closest('[data-row]');
      if (!row) return;
      const rows = Array.from(wrap.querySelectorAll('[data-row]'));
      if (rows.indexOf(row) !== 0) return;
      applyTitleSummary(target.value);
    });

    wrap.addEventListener('focusin', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.k !== 'answer_associate_input') return;
      openMenuForInput(target);
    });

    wrap.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.k === 'answer_associate_input') {
        openMenuForInput(target);
        return;
      }
      if (!target.closest('.cl93-user-wrap')) {
        closeMenus();
      }
    });

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const rootEl = getWrapper();
      if (!rootEl) return;
      if (!rootEl.contains(target)) closeMenus();
    });
  };

  const mountReadonlyDetails = async (event) => {
    if (kintone.app.getId() !== APP_ID) return;
    ensureStyle();

    const root =
      kintone.app.record.getSpaceElement(SPACE_CODE) ||
      kintone.app.record.getHeaderMenuSpaceElement();
    if (!root) return;

    const qid = text(event.record?.[QUESTION_ID]?.value).trim();
    const rows = await fetchDetailRows(qid);

    const toSafe = (v) => h(text(v || '-'));
    const toSafeWithLinks = (v) => {
      const s = text(v || '-');
      const re = /https?:\/\/[^\s<>"']+/g;
      let out = '';
      let last = 0;
      let m;
      while ((m = re.exec(s)) !== null) {
        const url = m[0];
        out += h(s.slice(last, m.index));
        out += `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(url)}</a>`;
        last = m.index + url.length;
      }
      out += h(s.slice(last));
      return out || '-';
    };
    const cards = rows
      .map((r, i) => {
        const assoc = r.answer_associate_code ? userDisplay(r.answer_associate_code) : '-';
        return `
          <section class="cl93-ro-card">
            <div class="cl93-row-top" style="margin-bottom:8px;">
              <div class="cl93-branch">枝番 ${i + 1}</div>
            </div>
            <dl class="cl93-ro-grid">
              <div class="cl93-ro-item"><dt>問い合わせ日付</dt><dd>${toSafe(r.question_date)}</dd></div>
              <div class="cl93-ro-item"><dt>ステータス</dt><dd>${toSafe(r.status)}</dd></div>
              <div class="cl93-ro-item cl93-ro-full"><dt>問い合わせ内容</dt><dd>${toSafeWithLinks(r.question_detail)}</dd></div>
              <div class="cl93-ro-item"><dt>回答日付</dt><dd>${toSafe(r.answer_date)}</dd></div>
              <div class="cl93-ro-item cl93-ro-wide cl93-ro-no-break"><dt>回答者</dt><dd>${toSafe(assoc)}</dd></div>
              <div class="cl93-ro-item cl93-ro-full"><dt>回答内容</dt><dd>${toSafeWithLinks(r.answer_detail)}</dd></div>
            </dl>
          </section>
        `;
      })
      .join('');

    root.innerHTML = `
      <section id="${WRAP_ID}">
        <div class="cl93-head">
          <div>
            <div class="cl93-title">問い合わせ明細（アプリ94）</div>
            <div class="cl93-sub">詳細画面は読み取り専用です</div>
          </div>
        </div>
        <div class="cl93-ro-list">
          ${cards || '<div class="cl93-empty">問い合わせ明細はありません。</div>'}
        </div>
      </section>
    `;
  };

  const mountClientAddButton = () => {
    const buttonId = 'cl93-client-add-near-search';
    const old = document.getElementById(buttonId);
    if (old) old.remove();

    const btn = document.createElement('button');
    btn.id = buttonId;
    btn.type = 'button';
    btn.className = 'cl93-client-btn-link';
    btn.textContent = '新規追加';
    btn.onclick = async () => {
      const seed = text(kintone.app.record.get().record?.[CLIENT_NAME]?.value).trim();
      const name = window.prompt('顧客管理へ登録するクライアント名を入力してください。', seed);
      if (name == null) return;

      btn.disabled = true;
      try {
        const created = await createClientQuick(name);
        const state = kintone.app.record.get();
        if (state && state.record) {
          if (state.record[CLIENT_NO]) state.record[CLIENT_NO].value = created.clientNo;
          if (state.record[CLIENT_NAME]) state.record[CLIENT_NAME].value = created.clientName;
          if (state.record.client_search) {
            state.record.client_search.value = `【${created.clientNo}】${created.clientName}`;
          }
          kintone.app.record.set(state);
        }
        window.alert(`顧客管理へ登録しました: ${created.clientNo} / ${created.clientName}`);
      } catch (err) {
        window.alert(err && err.message ? err.message : '顧客管理への新規登録に失敗しました。');
      } finally {
        btn.disabled = false;
      }
    };
    // Prefer placing next to field label; fallback to field container/header space.
    const fieldEl = kintone.app.record.getFieldElement('client_search');
    const reqMark = document.querySelector('.control-label-gaia.label-13312626 .require-cybozu');
    const exactLabel = document.querySelector('.control-label-gaia.label-13312626');
    const labelByText = Array.from(document.querySelectorAll('label, .control-label-gaia, .gaia-argoui-app-edit-layout-formname'))
      .find((el) => text(el.textContent).includes('クライアント検索'));

    if (reqMark && reqMark.parentElement) {
      reqMark.insertAdjacentElement('afterend', btn);
      return true;
    }

    if (exactLabel && exactLabel.parentElement) {
      exactLabel.insertAdjacentElement('afterend', btn);
      return true;
    }

    if (labelByText && labelByText.parentElement) {
      labelByText.insertAdjacentElement('afterend', btn);
      return true;
    }

    if (fieldEl) {
      const row =
        fieldEl.closest('.row-gaia') ||
        fieldEl.closest('.control-gaia') ||
        fieldEl.closest('.gaia-argoui-app-edit-layout-row') ||
        fieldEl.parentElement;
      const labelEl =
        row &&
        (row.querySelector('label') ||
          row.querySelector('.control-label-gaia') ||
          row.querySelector('.gaia-argoui-app-edit-layout-formname'));
      if (labelEl && labelEl.parentElement) {
        labelEl.parentElement.appendChild(btn);
        return true;
      }
      if (fieldEl.parentElement) {
        fieldEl.parentElement.appendChild(btn);
        return true;
      }
      fieldEl.appendChild(btn);
      return true;
    }

    const header = kintone.app.record.getHeaderMenuSpaceElement();
    if (header) {
      header.appendChild(btn);
      return true;
    }
    return false;
  };

  const mountClientAddButtonWithRetry = () => {
    let tries = 0;
    const tick = () => {
      tries += 1;
      const ok = mountClientAddButton();
      if (!ok && tries < 20) {
        window.setTimeout(tick, 250);
      }
    };
    tick();
  };

  kintone.events.on(
    ['app.record.create.show', 'app.record.edit.show', 'app.record.index.edit.show', 'app.record.detail.show'],
    (event) => {
    if (kintone.app.getId() !== APP_ID) return event;
    if (event.record && event.record[QUESTION_ID]) {
      event.record[QUESTION_ID].disabled = true;
    }
    if (event.type === 'app.record.detail.show') {
      mountReadonlyDetails(event).catch((err) => {
        console.error('[app93-contact-list] detail mount failed', err);
      });
      return event;
    }

    if (event.type !== 'app.record.index.edit.show') {
      mount(event).catch((err) => {
        console.error('[app93-contact-list] mount failed', err);
      });
      mountClientAddButtonWithRetry();
    }
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], async (event) => {
    if (kintone.app.getId() !== APP_ID) return event;
    if (!event.record || !event.record[QUESTION_ID]) return event;

    try {
      const isCreate = event.type === 'app.record.create.submit';
      const nextQuestionId = await ensureQuestionId({
        record: event.record,
        isCreate,
        recordId: event.recordId || null,
      });
      event.record[QUESTION_ID].value = nextQuestionId;

      const rows = collectRows();
      validateRows(rows);
      await replaceDetails(nextQuestionId, rows);

      return event;
    } catch (err) {
      event.error = err && err.message ? err.message : '問い合わせ管理の保存処理に失敗しました。';
      return event;
    }
  });

  kintone.events.on(['app.record.detail.delete.submit', 'app.record.index.delete.submit'], async (event) => {
    if (kintone.app.getId() !== APP_ID) return event;
    try {
      const qid = text(event?.record?.[QUESTION_ID]?.value).trim();
      await deleteDetailsByQuestionId(qid);
      return event;
    } catch (err) {
      event.error =
        err && err.message
          ? `関連する問い合わせ明細の削除に失敗しました: ${err.message}`
          : '関連する問い合わせ明細の削除に失敗しました。';
      return event;
    }
  });
})();
