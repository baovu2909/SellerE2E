const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT } = require('./helpers');

const BASE_URLS = { dev: 'https://dev-seller.amfshopvn.vn', test: 'https://test-seller.amfshopvn.vn' };
const PW_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const authFile = (envName) => path.join(ROOT, '.auth', `${envName}.json`);

function readToken(envName) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(authFile(envName), 'utf8'));
  } catch {
    return null;
  }
  for (const origin of state.origins ?? []) {
    const item = origin.localStorage?.find((l) => /auth/i.test(l.name) && l.value.includes('"token"'));
    if (!item) continue;
    try {
      const token = JSON.parse(item.value).token;
      const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp;
      if (exp * 1000 > Date.now() + 60_000) return token;
    } catch {}
  }
  return null;
}

const logins = {};

function login(envName, account) {
  logins[envName] ??= new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PW_CLI, 'test', '--project=setup', '--reporter=line'], {
      cwd: ROOT,
      env: {
        ...process.env,
        ENV: envName,
        FORCE_COLOR: '0',
        ...(account ? { SELLER_USERNAME: account.username, SELLER_PASSWORD: account.password } : {}),
      },
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => {
      delete logins[envName];
      if (code === 0) return resolve();
      const reason = out.match(/Error: (.*)/)?.[1] ?? `mã thoát ${code}`;
      reject(new Error(`Đăng nhập ${envName} thất bại: ${reason}`));
    });
  });
  return logins[envName];
}

async function sellerGet(envName, apiPath, account, body) {
  const call = async () => {
    const token = readToken(envName);
    if (!token) return { status: 401 };
    const res = await fetch(`${BASE_URLS[envName]}/api/${apiPath}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  let r = await call();
  if (r.status === 401) {
    await login(envName, account);
    r = await call();
  }
  if (r.status !== 200) throw new Error(`API ${apiPath} trả lỗi ${r.status}${r.body?.message ? `: ${r.body.message}` : ''}`);
  return r.body;
}

module.exports = { sellerGet };
