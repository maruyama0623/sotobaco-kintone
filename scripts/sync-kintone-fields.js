#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT = process.cwd();
const APP_LIST_PATH = path.join(ROOT, 'APP_LIST.md');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'kintone-fields');

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

const parseAppList = (md) => {
  const lines = md.split(/\r?\n/);
  const apps = [];
  for (const line of lines) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    apps.push({ id: Number(m[1]), name: m[2] });
  }
  return apps;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  let appId = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--app' && args[i + 1]) {
      appId = Number(args[i + 1]);
      i += 1;
    }
  }
  return { appId };
};

const fetchFields = async (appId) => {
  const url = `${baseUrl}/k/v1/app/form/fields.json`;

  const res = await axios.get(url, {
    params: { app: appId },
    headers: {
      'X-Cybozu-Authorization': authToken,
    },
  });
  return res.data;
};

const main = async () => {
  if (!fs.existsSync(APP_LIST_PATH)) {
    console.error(`[error] Not found: ${APP_LIST_PATH}`);
    process.exit(1);
  }

  const { appId: targetAppId } = parseArgs();
  const appList = parseAppList(fs.readFileSync(APP_LIST_PATH, 'utf8'));
  if (!appList.length) {
    console.error('[error] No apps found in APP_LIST.md');
    process.exit(1);
  }

  const targets = targetAppId
    ? appList.filter((a) => a.id === targetAppId)
    : appList;

  if (!targets.length) {
    console.error(`[error] App ID ${targetAppId} is not listed in APP_LIST.md`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const index = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    apps: [],
  };

  let okCount = 0;
  let ngCount = 0;
  for (const app of targets) {
    process.stdout.write(`[sync] app ${app.id} ${app.name} ... `);
    try {
      const data = await fetchFields(app.id);
      const out = {
        app: {
          id: app.id,
          name: app.name,
        },
        fetchedAt: new Date().toISOString(),
        revision: data.revision,
        properties: data.properties,
      };

      const outPath = path.join(OUTPUT_DIR, `app-${app.id}.json`);
      fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

      index.apps.push({
        id: app.id,
        name: app.name,
        status: 'ok',
        revision: data.revision,
        file: `app-${app.id}.json`,
        fieldCount: data.properties ? Object.keys(data.properties).length : 0,
      });
      okCount += 1;
      process.stdout.write('done\n');
    } catch (err) {
      ngCount += 1;
      const message = err && err.message ? err.message : String(err);
      index.apps.push({
        id: app.id,
        name: app.name,
        status: 'error',
        error: message,
      });
      process.stdout.write('failed\n');
      console.error(`  -> ${message}`);
    }
  }

  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  console.log(`[ok] Saved ${okCount} app field definitions to ${OUTPUT_DIR} (${ngCount} failed)`);
};

main().catch((err) => {
  console.error('[error] sync failed');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
