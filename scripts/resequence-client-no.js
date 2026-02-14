#!/usr/bin/env node
'use strict';

const axios = require('axios');

const APP_ID = 69;
const FIELD_CODE = 'client_no';
const RECORD_NUMBER_CODE = 'レコード番号';
const PREFIX = 'C';
const MIN_DIGITS = 5;
const PAGE_SIZE = 500;
const UPDATE_BATCH = 100;

const requiredEnv = ['KINTONE_BASE_URL', 'KINTONE_USERNAME', 'KINTONE_PASSWORD'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`[error] Missing env: ${key}`);
    process.exit(1);
  }
}

const normalizeBaseUrl = (u) => String(u).replace(/\/$/, '');
const baseUrl = normalizeBaseUrl(process.env.KINTONE_BASE_URL);
const authToken = Buffer.from(`${process.env.KINTONE_USERNAME}:${process.env.KINTONE_PASSWORD}`).toString('base64');
const shouldExecute = process.argv.includes('--execute');

const headers = {
  'X-Cybozu-Authorization': authToken,
};

const toCode = (num) => `${PREFIX}${String(num).padStart(MIN_DIGITS, '0')}`;

const fetchAllRecords = async () => {
  const records = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = `order by ${RECORD_NUMBER_CODE} asc limit ${PAGE_SIZE} offset ${offset}`;
    const res = await axios.get(`${baseUrl}/k/v1/records.json`, {
      params: {
        app: APP_ID,
        query,
        fields: ['$id', RECORD_NUMBER_CODE, FIELD_CODE],
      },
      headers,
    });
    const page = res.data.records || [];
    records.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return records;
};

const updateBatch = async (rows) => {
  if (!rows.length) return;
  await axios.put(
    `${baseUrl}/k/v1/records.json`,
    {
      app: APP_ID,
      records: rows,
    },
    { headers }
  );
};

const main = async () => {
  const records = await fetchAllRecords();
  if (!records.length) {
    console.log('[ok] 対象レコードが0件でした。');
    return;
  }

  const updates = [];
  let changed = 0;
  records.forEach((rec, idx) => {
    const id = rec.$id.value;
    const nextCode = toCode(idx + 1);
    const current = rec[FIELD_CODE] ? rec[FIELD_CODE].value : '';
    const recordNo = rec[RECORD_NUMBER_CODE] ? rec[RECORD_NUMBER_CODE].value : '-';
    if (current !== nextCode) changed += 1;
    updates.push({
      id,
      record: {
        [FIELD_CODE]: { value: nextCode },
      },
      _meta: { recordNo, from: current, to: nextCode },
    });
  });

  console.log(`[info] 対象件数: ${records.length}`);
  console.log(`[info] 変更件数: ${changed}`);
  console.log('[info] 先頭5件プレビュー:');
  updates.slice(0, 5).forEach((u) => {
    console.log(`  #${u._meta.recordNo} id=${u.id} ${u._meta.from || '(blank)'} -> ${u._meta.to}`);
  });

  if (!shouldExecute) {
    console.log('[dry-run] 実更新は未実施です。実行するには --execute を付けてください。');
    return;
  }

  let done = 0;
  for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
    const chunk = updates.slice(i, i + UPDATE_BATCH).map((u) => ({
      id: u.id,
      record: u.record,
    }));
    await updateBatch(chunk);
    done += chunk.length;
    console.log(`[apply] ${done}/${updates.length}`);
  }

  console.log('[ok] client_no をレコード番号昇順で再配番しました。');
};

main().catch((err) => {
  console.error('[error] resequence failed');
  console.error(err && err.response ? JSON.stringify(err.response.data, null, 2) : err);
  process.exit(1);
});
