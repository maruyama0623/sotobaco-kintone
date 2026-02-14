(() => {
  'use strict';

  const APP_ID = 69;
  const FIELD_CODE = 'client_no';
  const POSTCODE_FIELD = 'postcode';
  const ADDRESS_FIELD = 'address';
  const PREFIX = 'C';
  const MIN_DIGITS = 5;
  const MAX_ASSIGN_RETRY = 5;

  const esc = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const toCode = (num) => `${PREFIX}${String(num).padStart(MIN_DIGITS, '0')}`;

  const parseCodeNumber = (value) => {
    const m = String(value || '').trim().match(new RegExp(`^${PREFIX}(\\d+)$`));
    return m ? Number(m[1]) : null;
  };

  const fetchRecords = async (query, fields = [FIELD_CODE]) =>
    kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_ID,
      query,
      fields,
    });

  const existsCode = async (code, excludeRecordId = null) => {
    const cond = [`${FIELD_CODE} = "${esc(code)}"`];
    if (excludeRecordId) cond.push(`$id != "${excludeRecordId}"`);
    const res = await fetchRecords(`${cond.join(' and ')} limit 1`);
    return (res.records || []).length > 0;
  };

  const getMaxCodeNumber = async () => {
    const limit = 500;
    let offset = 0;
    while (offset <= 5000) {
      const res = await fetchRecords(
        `${FIELD_CODE} >= "${PREFIX}" and ${FIELD_CODE} < "D" order by ${FIELD_CODE} desc limit ${limit} offset ${offset}`
      );
      const records = res.records || [];
      if (!records.length) return 0;
      for (const rec of records) {
        const num = parseCodeNumber(rec?.[FIELD_CODE]?.value);
        if (num !== null) return num;
      }
      offset += limit;
    }
    return 0;
  };

  const getNextCode = async () => toCode((await getMaxCodeNumber()) + 1);

  const pickAvailableCode = async (excludeRecordId = null) => {
    let num = parseCodeNumber(await getNextCode()) || 1;
    for (let i = 0; i < 1000; i += 1) {
      const code = toCode(num + i);
      if (!(await existsCode(code, excludeRecordId))) return code;
    }
    throw new Error('クライアントCDの採番候補が見つかりませんでした。');
  };

  const needsReassignOnCreate = async (rawValue) => {
    const value = String(rawValue || '').trim();
    if (!value) return true;
    return existsCode(value);
  };

  const normalizePostcode = (raw) => String(raw || '').replace(/[^\d]/g, '');

  const fetchAddressByPostcode = async (postcode) => {
    const url = `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${postcode}`;
    const [body, status] = await kintone.proxy(url, 'GET', {}, {});
    if (Number(status) < 200 || Number(status) >= 300) {
      throw new Error('住所検索APIの呼び出しに失敗しました。');
    }
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data || Number(data.status) !== 200 || !Array.isArray(data.results) || !data.results.length) {
      return '';
    }
    const r = data.results[0];
    return `${r.address1 || ''}${r.address2 || ''}${r.address3 || ''}`.trim();
  };

  kintone.events.on(['app.record.create.show', 'app.record.edit.show', 'app.record.index.edit.show'], (event) => {
    if (kintone.app.getId() !== APP_ID) return event;
    if (!event.record || !event.record[FIELD_CODE]) return event;
    event.record[FIELD_CODE].disabled = true;
    return event;
  });

  kintone.events.on(['app.record.create.change.postcode', 'app.record.edit.change.postcode'], (event) => {
    if (kintone.app.getId() !== APP_ID) return event;
    if (!event.record || !event.record[POSTCODE_FIELD] || !event.record[ADDRESS_FIELD]) return event;

    event.record[POSTCODE_FIELD].error = null;
    const postcode = normalizePostcode(event.record[POSTCODE_FIELD].value);
    if (!postcode) return event;
    if (postcode.length !== 7) {
      event.record[POSTCODE_FIELD].error = '郵便番号は7桁で入力してください。';
      return event;
    }

    fetchAddressByPostcode(postcode)
      .then((address) => {
        const state = kintone.app.record.get();
        if (!state || !state.record || !state.record[POSTCODE_FIELD] || !state.record[ADDRESS_FIELD]) return;

        // Ignore stale responses when postcode has changed during request.
        if (normalizePostcode(state.record[POSTCODE_FIELD].value) !== postcode) return;

        if (!address) {
          state.record[POSTCODE_FIELD].error = '該当する住所が見つかりませんでした。';
          kintone.app.record.set(state);
          return;
        }

        state.record[POSTCODE_FIELD].error = null;
        state.record[ADDRESS_FIELD].value = address;
        kintone.app.record.set(state);
      })
      .catch((err) => {
        const state = kintone.app.record.get();
        if (!state || !state.record || !state.record[POSTCODE_FIELD]) return;
        if (normalizePostcode(state.record[POSTCODE_FIELD].value) !== postcode) return;
        state.record[POSTCODE_FIELD].error =
          err && err.message ? err.message : '住所の自動取得に失敗しました。';
        kintone.app.record.set(state);
      });

    return event;
  });

  kintone.events.on(
    ['app.record.create.submit', 'app.record.edit.submit'],
    async (event) => {
      if (kintone.app.getId() !== APP_ID) return event;
      if (!event.record || !event.record[FIELD_CODE]) return event;

      const isCreate = event.type === 'app.record.create.submit';
      const currentValue = event.record[FIELD_CODE].value;
      let shouldAssign = !String(currentValue || '').trim();

      if (isCreate && !shouldAssign) {
        shouldAssign = await needsReassignOnCreate(currentValue);
      }
      if (!shouldAssign) return event;

      const excludeRecordId = event.recordId ? String(event.recordId) : null;
      try {
        for (let i = 0; i < MAX_ASSIGN_RETRY; i += 1) {
          const candidate = await pickAvailableCode(excludeRecordId);
          if (!(await existsCode(candidate, excludeRecordId))) {
            event.record[FIELD_CODE].value = candidate;
            return event;
          }
        }
        event.error =
          'クライアントCDの採番に失敗しました。時間をおいて再実行してください。';
        return event;
      } catch (err) {
        event.error =
          err && err.message
            ? err.message
            : 'クライアントCDの採番に失敗しました。';
        return event;
      }
    }
  );
})();
