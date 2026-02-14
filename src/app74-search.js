(() => {
  'use strict';

  const APP_ID = 74;

  // Reusable config pattern:
  // - multiple: true  -> multi-select UI + multi-value query
  // - queryOperator   -> in | like | equals
  // - optionSource    -> static | records
  const VIEW_CONFIG = {
    13312081: {
      storageKey: 'app74-v13312081-search-v4',
      fields: [
        {
          type: 'dropdown',
          code: 'client_name',
          placeholder: 'クライアント名',
          width: '350px',
          optionSource: 'records',
          sourceAppId: 69,
          sourceFieldCode: 'client_name',
          limit: 200,
          queryOperator: 'like',
        },
        {
          type: 'dropdown',
          code: '請求種別',
          placeholder: '請求種別',
          width: '220px',
          multiple: true,
          queryOperator: 'in',
          optionSource: 'static',
          options: ['ソトバコポータル', 'Btone', '受託'],
        },
        {
          type: 'date',
          code: '支払期限',
          placeholder: '支払期限',
          width: '150px',
          queryOperator: 'equals',
        },
      ],
    },
  };

  const CONTAINER_ID = `custom-search-box-${APP_ID}`;

  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const splitQuery = (q) => {
    const lower = String(q || '').toLowerCase();
    const idx = lower.search(/\sorder\s+by\s|\slimit\s|\soffset\s/);
    if (idx === -1) return { where: String(q || '').trim(), tail: '' };
    return { where: String(q || '').slice(0, idx).trim(), tail: String(q || '').slice(idx).trim() };
  };

  const getBaseQuery = (currentQuery) => {
    const conditionRaw =
      typeof kintone.app.getQueryCondition === 'function'
        ? kintone.app.getQueryCondition() || ''
        : splitQuery(currentQuery).where;
    let where = splitQuery(conditionRaw).where;
    if (/^order\s+by/i.test(where)) where = '';
    return where;
  };

  const parseQuotedValues = (raw) => {
    const values = [];
    const re = /"((?:\\.|[^"\\])*)"/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      values.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
    return values;
  };

  const fetchFieldValues = async ({ appId, fieldCode, keyword = '', limit = 200, prefix = false }) => {
    const hasKeyword = keyword && keyword.trim();
    const query = hasKeyword
      ? prefix
        ? `${fieldCode} like "${esc(keyword.trim())}%" order by ${fieldCode} asc limit ${limit}`
        : `${fieldCode} like "${esc(keyword.trim())}" order by ${fieldCode} asc limit ${limit}`
      : `${fieldCode} != "" order by ${fieldCode} asc limit ${limit}`;

    const res = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: appId,
      query,
      fields: [fieldCode],
    });

    const items = [];
    (res.records || []).forEach((r) => {
      if (!r[fieldCode]) return;
      const value = r[fieldCode].value;
      if (Array.isArray(value)) {
        value.forEach((v) => {
          if (v) items.push(v);
        });
      } else if (value) {
        items.push(value);
      }
    });

    return [...new Set(items)];
  };

  const getOperator = (field) => {
    if (field.queryOperator) return field.queryOperator;
    if (field.multiple) return 'in';
    if (field.type === 'date' || field.type === 'datetime') return 'equals';
    return 'like';
  };

  const buildCondition = (field, rawValue) => {
    const op = getOperator(field);
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      const mode = rawValue.mode || 'exact';
      if (mode === 'range') {
        const from = String(rawValue.from || '').trim();
        const to = String(rawValue.to || '').trim();
        if (from && to) return `(${field.code} >= "${esc(from)}" and ${field.code} <= "${esc(to)}")`;
        if (from) return `${field.code} >= "${esc(from)}"`;
        if (to) return `${field.code} <= "${esc(to)}"`;
        return '';
      }

      const exact = String(rawValue.value || '').trim();
      if (!exact) return '';
      if (op === 'in') return `${field.code} in ("${esc(exact)}")`;
      if (op === 'equals') return `${field.code} = "${esc(exact)}"`;
      return `${field.code} like "${esc(exact)}"`;
    }

    if (Array.isArray(rawValue)) {
      const values = rawValue.filter(Boolean);
      if (!values.length) return '';
      if (op === 'in') {
        return `${field.code} in (${values.map((v) => `"${esc(v)}"`).join(', ')})`;
      }
      if (op === 'equals') {
        return `(${values.map((v) => `${field.code} = "${esc(v)}"`).join(' or ')})`;
      }
      return `(${values.map((v) => `${field.code} like "${esc(v)}"`).join(' or ')})`;
    }

    const value = String(rawValue || '').trim();
    if (!value) return '';

    if (op === 'in') return `${field.code} in ("${esc(value)}")`;
    if (op === 'equals') return `${field.code} = "${esc(value)}"`;
    return `${field.code} like "${esc(value)}"`;
  };

  const ensureStyles = () => {
    const styleId = `${CONTAINER_ID}-style`;
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${CONTAINER_ID} .custom-search-caret {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: #8a8a8a;
        font-size: 12px;
        line-height: 1;
        pointer-events: none;
        z-index: 1;
      }
      #${CONTAINER_ID} input[list]::-webkit-calendar-picker-indicator {
        opacity: 0;
      }
      #${CONTAINER_ID} .custom-search-select {
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        padding-right: 34px !important;
      }
      #${CONTAINER_ID} .custom-search-select::-ms-expand {
        display: none;
      }
      #${CONTAINER_ID} .custom-multi {
        position: relative;
      }
      #${CONTAINER_ID} .custom-multi summary {
        list-style: none;
      }
      #${CONTAINER_ID} .custom-multi summary::-webkit-details-marker {
        display: none;
      }
      #${CONTAINER_ID} .custom-multi-summary {
        height: 48px;
        border: 1px solid #d0d7de;
        border-radius: 3px;
        box-sizing: border-box;
        background: #fff;
        display: flex;
        align-items: center;
        padding: 0 52px 0 12px;
        font-size: 14px;
        color: #333;
        cursor: pointer;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      #${CONTAINER_ID} .custom-multi-panel {
        position: absolute;
        z-index: 10;
        top: calc(100% + 4px);
        left: 0;
        width: 100%;
        max-height: 220px;
        overflow: auto;
        background: #fff;
        border: 1px solid #d0d7de;
        border-radius: 3px;
        box-sizing: border-box;
        padding: 6px 0;
      }
      #${CONTAINER_ID} .custom-multi-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        font-size: 13px;
        color: #333;
        cursor: pointer;
      }
      #${CONTAINER_ID} .custom-multi-option:hover {
        background: #f5f8fa;
      }
      #${CONTAINER_ID} .custom-clear-x {
        position: absolute;
        right: 30px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 16px;
        color: #999;
        cursor: pointer;
        display: none;
        line-height: 1;
        padding: 2px 4px;
        z-index: 2;
      }
      #${CONTAINER_ID} .date-field-wrap {
        position: relative;
      }
      #${CONTAINER_ID} .date-input-single,
      #${CONTAINER_ID} .date-input-range {
        width: 100%;
      }
      #${CONTAINER_ID} .date-input-range {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #${CONTAINER_ID} .date-range-sep {
        flex: 0 0 auto;
        color: #666;
        font-size: 14px;
      }
      #${CONTAINER_ID} .date-input {
        width: auto;
        flex: 1 1 0;
        height: 48px;
        padding: 6px 12px;
        border: 1px solid #d0d7de;
        border-radius: 3px;
        box-sizing: border-box;
        font-size: 14px;
        outline: none;
        background: #fff;
      }
    `;
    document.head.appendChild(style);
  };

  const baseQueryStore = {};
  let detachOutsideCloseHandler = null;

  kintone.events.on('app.record.index.show', (event) => {
    if (kintone.app.getId() !== APP_ID) return event;

    const viewId = event.viewId;
    const config = VIEW_CONFIG[viewId];
    if (!config) return event;

    const fields = config.fields;
    const storageKey = config.storageKey;

    const currentQuery = kintone.app.getQuery() || '';
    if (baseQueryStore[viewId] === undefined) {
      const stored = sessionStorage.getItem(storageKey);
      if (stored !== null) {
        baseQueryStore[viewId] = stored;
      } else {
        baseQueryStore[viewId] = getBaseQuery(currentQuery);
        sessionStorage.setItem(storageKey, baseQueryStore[viewId]);
      }
    }
    const baseQuery = baseQueryStore[viewId];

    ensureStyles();

    if (detachOutsideCloseHandler) {
      detachOutsideCloseHandler();
      detachOutsideCloseHandler = null;
    }

    const old = document.getElementById(CONTAINER_ID);
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = CONTAINER_ID;
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'flex-start';
    wrap.style.gap = '8px';
    wrap.style.flexWrap = 'wrap';
    wrap.style.padding = '0 0 0 16px';

    const inputs = {};

    const apply = () => {
      const conds = [];
      fields.forEach((f) => {
        const control = inputs[f.code];
        if (!control) return;
        const cond = buildCondition(f, control.get());
        if (cond) conds.push(cond);
      });

      const base = splitQuery(baseQuery || '');
      const where = conds.length
        ? base.where
          ? `(${base.where}) and (${conds.join(' and ')})`
          : conds.join(' and ')
        : base.where;
      const finalQuery = [where, base.tail].filter(Boolean).join(' ');

      const appId = kintone.app.getId();
      const params = new URLSearchParams();
      params.set('view', String(viewId));
      if (finalQuery) params.set('query', finalQuery);
      window.location.href = `/k/${appId}/?${params.toString()}`;
    };

    const clear = () => {
      Object.values(inputs).forEach((control) => control.clear());
      const base = splitQuery(baseQuery || '');
      const finalQuery = [base.where, base.tail].filter(Boolean).join(' ');

      const appId = kintone.app.getId();
      const params = new URLSearchParams();
      params.set('view', String(viewId));
      if (finalQuery) params.set('query', finalQuery);
      window.location.href = `/k/${appId}/?${params.toString()}`;
    };

    fields.forEach((field) => {
      const fieldWrap = document.createElement('div');
      fieldWrap.style.cssText = `
        position: relative;
        display: inline-block;
        width: ${field.width || '240px'};
        margin-right: 8px;
      `;

      const label = document.createElement('span');
      label.textContent = field.placeholder;
      label.style.cssText = `
        position: absolute;
        top: -8px;
        left: 10px;
        padding: 0 4px;
        background: #fff;
        font-size: 11px;
        color: #888;
        z-index: 3;
        pointer-events: none;
      `;

      if (field.type === 'date' || field.type === 'datetime') {
        const dateWrap = document.createElement('div');
        dateWrap.className = 'date-field-wrap';

        const inputType = field.type === 'datetime' ? 'datetime-local' : 'date';
        const singleWrap = document.createElement('div');
        singleWrap.className = 'date-input-single';
        const exactInput = document.createElement('input');
        exactInput.type = inputType;
        exactInput.className = 'date-input';
        singleWrap.appendChild(exactInput);

        const rangeWrap = document.createElement('div');
        rangeWrap.className = 'date-input-range';
        rangeWrap.style.display = 'none';
        const fromInput = document.createElement('input');
        fromInput.type = inputType;
        fromInput.className = 'date-input';
        const rangeSep = document.createElement('span');
        rangeSep.className = 'date-range-sep';
        rangeSep.textContent = '〜';
        const toInput = document.createElement('input');
        toInput.type = inputType;
        toInput.className = 'date-input';
        rangeWrap.appendChild(fromInput);
        rangeWrap.appendChild(rangeSep);
        rangeWrap.appendChild(toInput);

        const modeStorageKey = `${storageKey}:${field.code}:mode`;
        let mode = sessionStorage.getItem(modeStorageKey) === 'range' ? 'range' : 'exact';
        const baseLabel = field.placeholder;
        const exactWidth = field.width || '220px';
        const exactWidthNum = Number.parseInt(exactWidth, 10);
        const rangeWidth = field.rangeWidth || `${Number.isFinite(exactWidthNum) ? Math.max(300, exactWidthNum * 2 + 24) : 300}px`;

        const refreshMode = () => {
          const isExact = mode === 'exact';
          label.textContent = `${baseLabel}[${isExact ? '指定' : '期間'}]`;
          singleWrap.style.display = isExact ? 'block' : 'none';
          rangeWrap.style.display = isExact ? 'none' : 'flex';
          fieldWrap.style.width = isExact ? exactWidth : rangeWidth;
          sessionStorage.setItem(modeStorageKey, mode);
        };

        label.style.pointerEvents = 'auto';
        label.style.cursor = 'pointer';
        label.addEventListener('click', () => {
          mode = mode === 'exact' ? 'range' : 'exact';
          exactInput.value = '';
          fromInput.value = '';
          toInput.value = '';
          refreshMode();
          apply();
        });

        [exactInput, fromInput, toInput].forEach((el) => {
          el.addEventListener('change', () => {
            refreshMode();
            apply();
          });
        });

        fieldWrap.appendChild(label);
        dateWrap.appendChild(singleWrap);
        dateWrap.appendChild(rangeWrap);
        fieldWrap.appendChild(dateWrap);
        wrap.appendChild(fieldWrap);

        inputs[field.code] = {
          get: () => ({
            mode,
            value: exactInput.value || '',
            from: fromInput.value || '',
            to: toInput.value || '',
          }),
          set: (value) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              mode = value.mode === 'range' ? 'range' : 'exact';
              exactInput.value = value.value || '';
              fromInput.value = value.from || '';
              toInput.value = value.to || '';
            } else {
              mode = 'exact';
              exactInput.value = String(value || '');
              fromInput.value = '';
              toInput.value = '';
            }
            refreshMode();
          },
          clear: () => {
            mode = 'exact';
            exactInput.value = '';
            fromInput.value = '';
            toInput.value = '';
            refreshMode();
          },
        };

        refreshMode();
        return;
      }

      if (field.multiple) {
        const details = document.createElement('details');
        details.className = 'custom-multi';

        const summary = document.createElement('summary');
        summary.className = 'custom-multi-summary';
        const summaryText = document.createElement('span');
        summary.appendChild(summaryText);

        const clearX = document.createElement('span');
        clearX.className = 'custom-clear-x';
        clearX.textContent = '×';

        const caret = document.createElement('span');
        caret.className = 'custom-search-caret';
        caret.textContent = '▼';

        const panel = document.createElement('div');
        panel.className = 'custom-multi-panel';

        let selected = new Set();
        let loaded = false;
        let optionsCache = [];

        const updateSummary = () => {
          if (selected.size === 0) {
            summaryText.textContent = '';
            clearX.style.display = 'none';
            return;
          }
          summaryText.textContent = Array.from(selected).join(', ');
          clearX.style.display = 'block';
        };

        const renderOptions = () => {
          panel.innerHTML = '';
          optionsCache.forEach((opt) => {
            const row = document.createElement('label');
            row.className = 'custom-multi-option';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = opt;
            cb.checked = selected.has(opt);
            cb.addEventListener('change', () => {
              if (cb.checked) selected.add(opt);
              else selected.delete(opt);
              updateSummary();
              apply();
            });
            const txt = document.createElement('span');
            txt.textContent = opt;
            row.appendChild(cb);
            row.appendChild(txt);
            panel.appendChild(row);
          });
        };

        const ensureOptions = async () => {
          if (loaded) return;
          if (field.optionSource === 'records' || !Array.isArray(field.options) || !field.options.length) {
            optionsCache = await fetchFieldValues({
              appId: field.sourceAppId || APP_ID,
              fieldCode: field.sourceFieldCode || field.code,
              limit: field.limit || 200,
            });
          } else {
            optionsCache = [...new Set(field.options)];
          }

          Array.from(selected).forEach((v) => {
            if (!optionsCache.includes(v)) optionsCache.push(v);
          });

          loaded = true;
          renderOptions();
        };

        details.addEventListener('toggle', () => {
          if (details.open) ensureOptions();
        });

        clearX.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selected = new Set();
          updateSummary();
          renderOptions();
          apply();
        });

        fieldWrap.appendChild(label);
        details.appendChild(summary);
        details.appendChild(clearX);
        details.appendChild(caret);
        details.appendChild(panel);
        fieldWrap.appendChild(details);
        wrap.appendChild(fieldWrap);

        inputs[field.code] = {
          get: () => Array.from(selected),
          set: (values) => {
            const list = Array.isArray(values)
              ? values.filter(Boolean)
              : values
                ? [values]
                : [];
            selected = new Set(list);
            list.forEach((v) => {
              if (!optionsCache.includes(v)) optionsCache.push(v);
            });
            updateSummary();
            if (loaded) renderOptions();
          },
          clear: () => {
            selected = new Set();
            updateSummary();
            if (loaded) renderOptions();
          },
        };

        updateSummary();
        return;
      }

      if (field.type === 'dropdown') {
        const details = document.createElement('details');
        details.className = 'custom-multi';

        const summary = document.createElement('summary');
        summary.className = 'custom-multi-summary';
        const summaryText = document.createElement('span');
        summary.appendChild(summaryText);

        const clearX = document.createElement('span');
        clearX.className = 'custom-clear-x';
        clearX.textContent = '×';

        const caret = document.createElement('span');
        caret.className = 'custom-search-caret';
        caret.textContent = '▼';

        const panel = document.createElement('div');
        panel.className = 'custom-multi-panel';

        const addOption = (list, value) => {
          if (!value) return;
          if (list.includes(value)) return;
          list.push(value);
        };

        let selected = '';
        let optionsCache = [];
        let loaded = (field.options || []).length > 0;
        if (loaded) optionsCache = [...new Set(field.options || [])];

        const updateSummary = () => {
          summaryText.textContent = selected || '';
          clearX.style.display = selected ? 'block' : 'none';
        };

        const renderOptions = () => {
          panel.innerHTML = '';
          optionsCache.forEach((opt) => {
            const row = document.createElement('div');
            row.className = 'custom-multi-option';
            row.textContent = opt;
            row.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              selected = opt;
              updateSummary();
              details.open = false;
              apply();
            });
            panel.appendChild(row);
          });
        };

        const ensureDropdownOptions = async () => {
          if (loaded) return;
          const items = await fetchFieldValues({
            appId: field.sourceAppId || APP_ID,
            fieldCode: field.sourceFieldCode || field.code,
            limit: field.limit || 200,
          });
          items.forEach((v) => addOption(optionsCache, v));
          loaded = true;
          renderOptions();
        };

        details.addEventListener('toggle', () => {
          if (details.open) ensureDropdownOptions();
        });

        clearX.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selected = '';
          clearX.style.display = 'none';
          apply();
        });

        if (loaded) renderOptions();

        fieldWrap.appendChild(label);
        details.appendChild(summary);
        details.appendChild(clearX);
        details.appendChild(caret);
        details.appendChild(panel);
        fieldWrap.appendChild(details);
        wrap.appendChild(fieldWrap);

        inputs[field.code] = {
          get: () => selected || '',
          set: (value) => {
            const v = String(value || '');
            addOption(optionsCache, v);
            selected = v;
            updateSummary();
            if (loaded) renderOptions();
          },
          clear: () => {
            selected = '';
            clearX.style.display = 'none';
            updateSummary();
          },
        };

        updateSummary();
        return;
      }

      const input = document.createElement('input');
      input.type = field.type === 'date' ? 'date' : 'text';
      input.style.cssText = `
        width: 100%;
        height: 48px;
        padding: 6px 52px 6px 12px;
        border: 1px solid #d0d7de;
        border-radius: 3px;
        box-sizing: border-box;
        font-size: 14px;
        outline: none;
        background: #fff;
      `;

      const clearX = document.createElement('span');
      clearX.className = 'custom-clear-x';
      clearX.textContent = '×';

      clearX.addEventListener('click', () => {
        input.value = '';
        clearX.style.display = 'none';
        apply();
      });

      input.addEventListener('input', () => {
        clearX.style.display = input.value ? 'block' : 'none';
      });

      let composing = false;
      input.addEventListener('compositionstart', () => {
        composing = true;
      });
      input.addEventListener('compositionend', () => {
        composing = false;
      });

      if (field.type === 'datalist' && field.sourceAppId && field.sourceFieldCode) {
        const list = document.createElement('datalist');
        list.id = `${CONTAINER_ID}-${field.code}-list`;
        input.setAttribute('list', list.id);
        fieldWrap.appendChild(list);

        const caret = document.createElement('span');
        caret.className = 'custom-search-caret';
        caret.textContent = '▼';
        fieldWrap.appendChild(caret);

        let currentOptions = [];
        let fetchTimer = null;
        let lastInputValue = '';

        const updateDatalist = async (keyword) => {
          const items = await fetchFieldValues({
            appId: field.sourceAppId,
            fieldCode: field.sourceFieldCode,
            keyword,
            limit: field.limit || 200,
            prefix: true,
          });
          list.innerHTML = '';
          currentOptions = [...new Set(items)];
          currentOptions.forEach((v) => {
            const o = document.createElement('option');
            o.value = v;
            list.appendChild(o);
          });
        };

        input.addEventListener('focus', () => {
          if (currentOptions.length === 0) updateDatalist(input.value.trim());
        });

        input.addEventListener('input', () => {
          const val = input.value;
          if (!composing && currentOptions.includes(val) && val !== lastInputValue) {
            lastInputValue = val;
            apply();
            return;
          }
          lastInputValue = val;

          if (fetchTimer) clearTimeout(fetchTimer);
          fetchTimer = setTimeout(() => updateDatalist(val.trim()), 250);
        });
      }

      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!composing && !e.isComposing) apply();
      });

      fieldWrap.appendChild(label);
      fieldWrap.appendChild(input);
      fieldWrap.appendChild(clearX);
      wrap.appendChild(fieldWrap);

      inputs[field.code] = {
        get: () => input.value || '',
        set: (value) => {
          input.value = String(value || '');
          clearX.style.display = input.value ? 'block' : 'none';
        },
        clear: () => {
          input.value = '';
          clearX.style.display = 'none';
        },
      };
    });

    const searchBtn = document.createElement('button');
    searchBtn.textContent = '検索';
    searchBtn.style.height = '48px';
    searchBtn.style.padding = '0 18px';
    searchBtn.style.border = '1px solid #2c94d7';
    searchBtn.style.background = '#2c94d7';
    searchBtn.style.color = '#fff';
    searchBtn.style.borderRadius = '3px';
    searchBtn.style.cursor = 'pointer';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'クリア';
    clearBtn.style.height = '48px';
    clearBtn.style.padding = '0 18px';
    clearBtn.style.border = '1px solid #cfd7df';
    clearBtn.style.background = '#fff';
    clearBtn.style.color = '#333';
    clearBtn.style.borderRadius = '3px';
    clearBtn.style.cursor = 'pointer';

    searchBtn.onclick = apply;
    clearBtn.onclick = clear;
    wrap.appendChild(searchBtn);
    wrap.appendChild(clearBtn);

    const pager = document.querySelector('.gaia-argoui-app-index-pager');
    if (pager && pager.parentElement) {
      pager.parentElement.insertBefore(wrap, pager);
    } else {
      const headerSpace = kintone.app.getHeaderSpaceElement() || kintone.app.getHeaderMenuSpaceElement();
      if (headerSpace) headerSpace.appendChild(wrap);
    }

    const outsideCloseHandler = (ev) => {
      const openDropdowns = wrap.querySelectorAll('.custom-multi[open]');
      openDropdowns.forEach((el) => {
        if (!el.contains(ev.target)) {
          el.open = false;
        }
      });
    };
    document.addEventListener('click', outsideCloseHandler, true);
    detachOutsideCloseHandler = () => {
      document.removeEventListener('click', outsideCloseHandler, true);
    };

    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get('query') || '';

    if (urlQuery) {
      fields.forEach((f) => {
        const op = getOperator(f);
        const control = inputs[f.code];
        if (!control) return;
        const codePattern = escRegExp(f.code);

        if (f.type === 'date' || f.type === 'datetime') {
          const betweenRegex = new RegExp(
            `\\(?\\s*${codePattern}\\s*>=\\s*"(.+?)"\\s+and\\s+${codePattern}\\s*<=\\s+"(.+?)"\\s*\\)?`,
            'i'
          );
          const betweenMatch = urlQuery.match(betweenRegex);
          if (betweenMatch) {
            control.set({ mode: 'range', from: betweenMatch[1], to: betweenMatch[2] });
            return;
          }

          const fromRegex = new RegExp(`${codePattern}\\s*>=\\s*"(.+?)"`, 'i');
          const toRegex = new RegExp(`${codePattern}\\s*<=\\s*"(.+?)"`, 'i');
          const fromMatch = urlQuery.match(fromRegex);
          const toMatch = urlQuery.match(toRegex);
          if (fromMatch || toMatch) {
            control.set({
              mode: 'range',
              from: fromMatch ? fromMatch[1] : '',
              to: toMatch ? toMatch[1] : '',
            });
            return;
          }
        }

        if (op === 'in') {
          const inMatch = urlQuery.match(new RegExp(`${codePattern}\\s+in\\s*\\(([^)]*)\\)`, 'i'));
          if (!inMatch) return;
          const values = parseQuotedValues(inMatch[1]);
          control.set(values);
          return;
        }

        const mainRegex = op === 'equals'
          ? new RegExp(`${codePattern}\\s+=\\s+"(.+?)"`, 'i')
          : new RegExp(`${codePattern}\\s+like\\s+"(.+?)"`, 'i');
        const legacyRegex = new RegExp(`${codePattern}\\s+=\\s+"(.+?)"`, 'i');
        const match = urlQuery.match(mainRegex) || urlQuery.match(legacyRegex);
        if (!match) return;
        const restoredValue = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        control.set(restoredValue);
      });
    }

    return event;
  });
})();
