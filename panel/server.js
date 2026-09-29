const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { explainError } = require('./explain-error');

const PORT = Number(process.env.PANEL_PORT ?? 4000);
const ROOT = path.resolve(__dirname, '..');
const PW_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

const { int } = require('./lib/helpers');

/**
 * Lệnh chạy của từng tab: panel/tabs/<tab>/actions.js ({ [tên lệnh]: { args(body), env?(body) } }).
 * Server tự dò mọi thư mục trong panel/tabs/. Thêm tab mới = thêm 1 dòng .group trong index.html + thư mục tabs/<tab>/.
 */
const TABS_DIR = path.join(__dirname, 'tabs');
const tabNames = () => fs.readdirSync(TABS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

function loadActions() {
  const all = {};
  for (const tab of tabNames()) {
    const f = path.join(TABS_DIR, tab, 'actions.js');
    if (!fs.existsSync(f)) continue;
    delete require.cache[require.resolve(f)]; // sửa actions.js → lần chạy sau dùng bản mới
    for (const [name, action] of Object.entries(require(f))) {
      if (all[name]) throw new Error(`Lệnh "${name}" bị khai báo 2 lần (tab ${tab})`);
      all[name] = action;
    }
  }
  return all;
}

const ACCOUNTS_FILE = path.join(ROOT, 'env', 'accounts.json');

function readAccounts() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAccounts(all) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(all, null, 2));
}

const envOf = (v) => (v === 'test' ? 'test' : 'dev');

function accountsView(envName) {
  const { active = '', list = [] } = readAccounts()[envName] ?? {};
  return { active, list: list.map((a) => a.username) };
}

function activeAccount(envName) {
  const { active, list = [] } = readAccounts()[envName] ?? {};
  return list.find((a) => a.username === active) ?? null;
}

function updateAccounts(body) {
  const envName = envOf(body.env);
  const username = String(body.username ?? '').trim();
  const all = readAccounts();
  const data = (all[envName] ??= { active: '', list: [] });

  if (body.op === 'use' && !username) {
    data.active = '';
  } else if (!username) {
    throw new Error('Nhập tên đăng nhập');
  } else if (body.op === 'add') {
    const password = String(body.password ?? '');
    if (!password) throw new Error('Nhập mật khẩu');
    const found = data.list.find((a) => a.username === username);
    if (found) found.password = password;
    else data.list.push({ username, password });
    data.active = username;
  } else if (body.op === 'use') {
    if (!data.list.some((a) => a.username === username)) throw new Error(`Chưa lưu tài khoản "${username}"`);
    data.active = username;
  } else if (body.op === 'remove') {
    data.list = data.list.filter((a) => a.username !== username);
    if (data.active === username) data.active = data.list[0]?.username ?? '';
  } else {
    throw new Error('Thao tác không hợp lệ');
  }
  writeAccounts(all);
  return accountsView(envName);
}

let current = null;

function runAction(req, res, body) {
  let action;
  try {
    action = loadActions()[body.action];
  } catch (e) {
    return sendJson(res, 500, { error: `Lỗi đọc lệnh của tab: ${e.message}` });
  }
  const envName = body.env === 'test' ? 'test' : 'dev';
  if (!action) return sendJson(res, 400, { error: `Không có lệnh "${body.action}"` });
  if (current) return sendJson(res, 409, { error: 'Đang có lệnh chạy, bấm Dừng hoặc chờ xong' });

  let args, extraEnv;
  try {
    args = action.args(body);
    if (body.headed) args.push('--headed');
    extraEnv = action.env ? action.env(body) : {};
    if (body.headed && body.slowMo) extraEnv.SLOW_MO = String(int(body.slowMo, 0, 5000, 'Tốc độ'));
    const account = activeAccount(envName);
    if (account) Object.assign(extraEnv, { SELLER_USERNAME: account.username, SELLER_PASSWORD: account.password });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  const envDesc = Object.entries(extraEnv)
    .map(([k, v]) => `${k}=${/PASSWORD/.test(k) ? '***' : v} `)
    .join('');
  res.write(`$ ENV=${envName} ${envDesc}playwright ${args.join(' ')}\n\n`);

  const child = spawn(process.execPath, [PW_CLI, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...extraEnv,
      ENV: envName,
      FORCE_COLOR: '0',
    },
  });
  current = child;

  const write = (chunk) => res.write(chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''));
  child.stdout.on('data', write);
  child.stderr.on('data', write);
  child.on('close', (code) => {
    current = null;
    res.end(`\n__EXIT__${code ?? 'stopped'}\n`);
  });
}

function stop(res) {
  if (!current) return sendJson(res, 200, { ok: true });
  if (process.platform === 'win32') exec(`taskkill /pid ${current.pid} /T /F`);
  else current.kill('SIGTERM');
  sendJson(res, 200, { ok: true });
}

function openDetached(res, args, envName) {
  const child = spawn(process.execPath, [PW_CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ENV: envName },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  sendJson(res, 200, { ok: true });
}

const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webm': 'video/webm', '.zip': 'application/zip', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function serveFile(res, baseDir, relPath) {
  let file = path.resolve(baseDir, '.' + path.sep + decodeURIComponent(relPath));
  if (file !== baseDir && !file.startsWith(baseDir + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

function listResults(envName) {
  const base = path.join(ROOT, 'test-results', envName);
  const file = path.join(base, 'results.json');
  if (!fs.existsSync(file)) return { passed: [], failed: [], finishedAt: null };

  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { passed: [], failed: [], finishedAt: null };
  }

  const toUrl = (abs) => {
    if (!abs) return null;
    const rel = path.relative(base, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs)) return null;
    return `/results/${envName}/` + rel.split(path.sep).map(encodeURIComponent).join('/');
  };
  const stripAnsi = (t) => (t ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  const out = { passed: [], failed: [], finishedAt: fs.statSync(file).mtimeMs };
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        const r = t.results.at(-1);
        if (!r || r.status === 'skipped') continue;
        const att = r.attachments ?? [];
        const item = {
          name: [...titles, spec.title].filter(Boolean).join(' › '),
          project: t.projectName,
          location: `${spec.file}:${spec.line}`,
          duration: r.duration,
          error: stripAnsi((r.errors ?? []).map((e) => e.message).join('\n\n')).trim(),
          explain: r.status === 'passed' ? null : {
            ...explainError(
              stripAnsi((r.errors ?? []).map((e) => e.message).join('\n\n')),
              (() => {
                const ctx = att.find((a) => a.name === 'error-context')?.path;
                try { return ctx ? fs.readFileSync(ctx, 'utf8') : ''; } catch { return ''; }
              })(),
            ),
            // lỗi API trong lúc chạy (tests/api-errors.ts) — thường là nguyên nhân thật
            api: (() => {
              const a = att.find((x) => x.name === 'Lỗi API' && x.body);
              if (!a) return [];
              return Buffer.from(a.body, 'base64').toString('utf8').split('\n').filter((l) => l.startsWith('⚠')).slice(0, 3).map((l) => l.replace(/^⚠\s*/, ''));
            })(),
          },
          images: att
            .filter((a) => a.contentType?.startsWith('image/') && a.path)
            .map((a) => ({ name: a.name === 'screenshot' ? 'Màn hình cuối' : a.name, url: toUrl(a.path) }))
            .filter((a) => a.url),
          notes: att
            .filter((a) => a.contentType?.startsWith('text/plain') && a.body)
            .map((a) => ({ name: a.name, text: Buffer.from(a.body, 'base64').toString('utf8') })),
          video: toUrl(att.find((a) => a.name === 'video')?.path),
          trace: toUrl(att.find((a) => a.name === 'trace')?.path),
        };
        (r.status === 'passed' ? out.passed : out.failed).push(item);
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  for (const s of report.suites ?? []) walk(s, []);
  return out;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  // file giao diện của tab (tab.html, tab.js, …) — actions.js chạy phía server, không gửi ra trang
  if (req.method === 'GET' && pathname.startsWith('/tabs/')) {
    const rel = pathname.slice('/tabs/'.length);
    let base = '';
    try { base = path.basename(decodeURIComponent(rel)).toLowerCase(); } catch { return res.writeHead(400).end(); }
    if (base === 'actions.js' || base.endsWith('.json')) return res.writeHead(404).end();
    return serveFile(res, TABS_DIR, rel);
  }
  if (req.method === 'GET' && pathname === '/app.js') {
    return serveFile(res, __dirname, 'app.js');
  }
  if (req.method === 'GET' && pathname === '/panel.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(__dirname, 'panel.css')).pipe(res);
  }
  if (req.method === 'GET' && pathname.startsWith('/component/')) {
    return serveFile(res, path.join(__dirname, 'component'), pathname.slice('/component/'.length));
  }
  const staticMatch = pathname.match(/^\/(report|results)\/(dev|test)(\/.*)?$/);
  if ((req.method === 'GET' || req.method === 'HEAD') && staticMatch) {
    const [, kind, envName, rest = '/'] = staticMatch;
    if (kind === 'report' && !staticMatch[3]) return res.writeHead(302, { Location: `${pathname}/` }).end();
    const folder = kind === 'report' ? 'playwright-report' : 'test-results';
    return serveFile(res, path.join(ROOT, folder, envName), rest.slice(1));
  }

  if (req.method === 'GET' && pathname === '/results') {
    try {
      return sendJson(res, 200, listResults(searchParams.get('env') === 'test' ? 'test' : 'dev'));
    } catch (e) {
      console.error('Đọc kết quả lỗi:', e);
      return sendJson(res, 500, { passed: [], failed: [], error: e.message });
    }
  }
  if (req.method === 'GET' && req.url === '/livereload') return liveReload(req, res);
  if (req.method === 'GET' && req.url === '/status') return sendJson(res, 200, { running: !!current });
  if (req.method === 'POST' && req.url === '/run') return runAction(req, res, await readBody(req));
  if (req.method === 'POST' && req.url === '/stop') return stop(res);
  if (req.method === 'GET' && pathname === '/accounts') return sendJson(res, 200, accountsView(envOf(searchParams.get('env'))));
  if (req.method === 'POST' && pathname === '/accounts') {
    try {
      return sendJson(res, 200, updateAccounts(await readBody(req)));
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (req.method === 'POST' && req.url === '/ui') {
    const envName = (await readBody(req)).env === 'test' ? 'test' : 'dev';
    return openDetached(res, ['test', '--ui'], envName);
  }
  res.writeHead(404).end();
});

const reloadClients = new Set();

function liveReload(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 500\n\n');
  reloadClients.add(res);
  req.on('close', () => reloadClients.delete(res));
}

let reloadTimer;
fs.watch(__dirname, { recursive: true }, (_event, file) => {
  if (!file || file === 'server.js') return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`↻ ${file} thay đổi → tải lại trang`);
    for (const res of reloadClients) res.write('data: reload\n\n');
  }, 100);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Trang điều khiển: ${url}  (Ctrl+C để tắt)`);
  if (process.env.PANEL_NO_OPEN) return;
  setTimeout(() => {
    if (reloadClients.size) return;
    const opener = process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(opener);
  }, 1500);
});
