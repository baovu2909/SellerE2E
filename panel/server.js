/**
 * Trang điều khiển seller-e2e — chạy: npm run panel → http://localhost:4000
 * Chỉ lắng nghe trên 127.0.0.1 (máy của bạn), không cần cài thêm thư viện.
 *
 * Thêm lệnh mới: khai báo trong ACTIONS bên dưới + thêm 1 khung trong index.html.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { explainError } = require('./explain-error');

const PORT = Number(process.env.PANEL_PORT ?? 4000);
const ROOT = path.resolve(__dirname, '..');
const PW_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

const int = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} phải là số nguyên từ ${min} đến ${max}`);
  return n;
};

/** Mỗi action: args = tham số cho `playwright`, env = biến môi trường thêm vào */
const ACTIONS = {
  login: {
    args: () => ['test', '--project=setup'],
  },
  'create-stores': {
    args: (p) => ['test', '--project=data', 'tests/data/create-stores.spec.ts'],
    env: (p) => ({
      STORE_START: String(int(p.start, 1, 100000, 'Bắt đầu từ số')),
      STORE_COUNT: String(int(p.count, 1, 500, 'Số lượng')),
    }),
  },
  test: {
    args: () => ['test', '--project=chromium'],
  },
  roles: {
    args: () => ['test', '--project=roles'],
    // p.roles: ['owner','cashier',...] — trống = mọi vai trò đã điền tài khoản trong env
    env: (p) => {
      const keys = (Array.isArray(p.roles) ? p.roles : []).filter((k) => /^[a-zA-Z]+$/.test(k));
      return keys.length ? { ROLES_ONLY: keys.join(',') } : {};
    },
  },
  revenue: {
    args: () => ['test', '--project=reports', 'tests/reports/revenue-sync.spec.ts'],
    // Ô trống → khoảng ngày mặc định của trang (1 tháng gần nhất)
    env: (p) => {
      const date = (v, name) => {
        if (!v) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} phải có dạng YYYY-MM-DD`);
        return v;
      };
      const from = date(p.revenueFrom, 'Từ ngày');
      const to = date(p.revenueTo, 'Đến ngày');
      return { ...(from ? { REVENUE_FROM: from } : {}), ...(to ? { REVENUE_TO: to } : {}) };
    },
  },
  category: {
    args: () => ['test', '--project=features', 'tests/features/category.spec.ts'],
    // Ô trống → mặc định trong test: Thiết bị điện tử / Bộ phận máy tính / Danh mục test
    env: (p) => {
      const out = {};
      for (const [key, envName, label] of [['categoryLv1', 'CATEGORY_LV1', 'Cấp 1'], ['categoryLv2', 'CATEGORY_LV2', 'Cấp 2'], ['categoryName', 'CATEGORY_NAME', 'Cấp 3']]) {
        const v = String(p[key] ?? '').trim();
        if (v.length > 100) throw new Error(`Tên danh mục ${label} tối đa 100 ký tự`);
        if (v) out[envName] = v;
      }
      return out;
    },
  },
  product: {
    args: () => ['test', '--project=features', 'tests/features/product.spec.ts'],
    env: (p) => productEnv(p),
  },
  'product-import': {
    args: () => ['test', '--project=features', 'tests/features/product.spec.ts', '-g', '7. Nhập'],
    env: (p) => productEnv(p),
  },
  'category-tax': {
    args: () => ['test', '--project=features', 'tests/features/category-tax.spec.ts'],
  },
  lockout: {
    args: () => ['test', '--project=flows', 'tests/flows/login-lockout.spec.ts'],
    // Ô trống → dùng LOCK_TEST_USERNAME / LOCK_TEST_PASSWORD trong env/.env.<ENV>
    env: (p) => ({
      ...(p.lockUser ? { LOCK_TEST_USERNAME: String(p.lockUser).trim() } : {}),
      ...(p.lockPass ? { LOCK_TEST_PASSWORD: String(p.lockPass) } : {}),
    }),
  },
};

/**
 * Tài khoản đăng nhập đã lưu — env/accounts.json (không commit), tách theo môi trường:
 *   { "dev": { "active": "user1", "list": [{ "username": "user1", "password": "..." }] }, "test": {...} }
 * Tài khoản đang chọn được truyền vào mọi lệnh chạy qua SELLER_USERNAME / SELLER_PASSWORD
 * (ghi đè giá trị trong env/.env.<ENV>). Chưa lưu tài khoản nào → dùng file env như cũ.
 * Mật khẩu chỉ nằm ở server, không trả về trang.
 */
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

/** body: { env, op: 'add' | 'use' | 'remove', username, password? } */
function updateAccounts(body) {
  const envName = envOf(body.env);
  const username = String(body.username ?? '').trim();
  const all = readAccounts();
  const data = (all[envName] ??= { active: '', list: [] });

  if (body.op === 'use' && !username) {
    data.active = ''; // quay về tài khoản trong file env
  } else if (!username) {
    throw new Error('Nhập tên đăng nhập');
  } else if (body.op === 'add') {
    const password = String(body.password ?? '');
    if (!password) throw new Error('Nhập mật khẩu');
    const found = data.list.find((a) => a.username === username);
    if (found) found.password = password; // đã có → cập nhật mật khẩu
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

/**
 * File người dùng chọn trên trang (ảnh sản phẩm, file Excel nhập) → lưu tạm vào .uploads/<thời điểm>/
 * rồi truyền đường dẫn cho test qua env. Tự xoá thư mục tạm cũ hơn 1 ngày.
 */
const UPLOAD_ROOT = path.join(ROOT, '.uploads');

function saveUploads(files, max, label) {
  const list = Array.isArray(files) ? files : [];
  if (list.length > max) throw new Error(`${label}: tối đa ${max} file`);
  if (!list.length) return [];
  if (fs.existsSync(UPLOAD_ROOT)) {
    for (const d of fs.readdirSync(UPLOAD_ROOT)) {
      const full = path.join(UPLOAD_ROOT, d);
      if (Date.now() - fs.statSync(full).mtimeMs > 24 * 60 * 60 * 1000) fs.rmSync(full, { recursive: true, force: true });
    }
  }
  const dir = path.join(UPLOAD_ROOT, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return list.map((f, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${path.basename(String(f.name || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}`;
    const buf = Buffer.from(String(f.data || ''), 'base64');
    if (!buf.length) throw new Error(`${label}: file "${f.name}" rỗng`);
    if (buf.length > 25 * 1024 * 1024) throw new Error(`${label}: file "${f.name}" quá 25 MB`);
    const file = path.join(dir, name);
    fs.writeFileSync(file, buf);
    return file;
  });
}

/** Ô nhập của thẻ Sản phẩm → env cho tests/features/product.spec.ts (ô trống → test dùng mặc định) */
function productEnv(p) {
  const f = p.product ?? {};
  const out = {};
  const text = { name: 'PRODUCT_NAME', code: 'PRODUCT_CODE', category: 'PRODUCT_CATEGORY', shortDesc: 'PRODUCT_SHORT_DESC', sku: 'PRODUCT_SKU', unit: 'PRODUCT_UNIT', editName: 'PRODUCT_EDIT_NAME' };
  for (const [k, envName] of Object.entries(text)) {
    const v = String(f[k] ?? '').trim();
    if (v.length > 255) throw new Error(`Ô "${k}" tối đa 255 ký tự`);
    if (v) out[envName] = v;
  }
  if (f.code && !/^\d{13}$/.test(String(f.code).trim())) throw new Error('Mã EAN-13 phải gồm đúng 13 chữ số');
  const nums = { cost: ['PRODUCT_COST', 'Giá vốn'], price: ['PRODUCT_PRICE', 'Giá bán'], stock: ['PRODUCT_STOCK', 'Số lượng tồn'], editPrice: ['PRODUCT_EDIT_PRICE', 'Giá bán khi sửa'] };
  for (const [k, [envName, label]] of Object.entries(nums)) {
    const v = String(f[k] ?? '').replace(/[.,\s]/g, '');
    if (!v) continue;
    if (!/^\d+$/.test(v)) throw new Error(`${label} phải là số nguyên không âm`);
    out[envName] = v;
  }
  if (f.type === 'dich-vu') out.PRODUCT_TYPE = 'dich-vu';
  const images = saveUploads(p.uploads?.images, 10, 'Ảnh sản phẩm');
  if (images.length) out.PRODUCT_IMAGES = images.join('|');
  const excel = saveUploads(p.uploads?.importFile ? [p.uploads.importFile] : [], 1, 'File nhập');
  if (excel.length) out.PRODUCT_IMPORT_FILE = excel[0];
  return out;
}

let current = null; // tiến trình đang chạy (chỉ cho chạy 1 lệnh một lúc)

function runAction(req, res, body) {
  const action = ACTIONS[body.action];
  const envName = body.env === 'test' ? 'test' : 'dev';
  if (!action) return sendJson(res, 400, { error: `Không có lệnh "${body.action}"` });
  if (current) return sendJson(res, 409, { error: 'Đang có lệnh chạy, bấm Dừng hoặc chờ xong' });

  let args, extraEnv;
  try {
    // Reporter lấy từ playwright.config.ts: list (log) + html (Mở báo cáo) + json (tab Thành công / Lỗi)
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
  // Windows: kill cả cây tiến trình (kèm trình duyệt đang mở)
  if (process.platform === 'win32') exec(`taskkill /pid ${current.pid} /T /F`);
  else current.kill('SIGTERM');
  sendJson(res, 200, { ok: true });
}

/** Mở cửa sổ riêng (Playwright UI), chạy độc lập với trang điều khiển */
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

/** Trả 1 file nằm trong baseDir (chặn ../ thoát ra ngoài). Thư mục → index.html */
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

/**
 * Kết quả lần chạy gần nhất (đọc test-results/<env>/results.json do reporter json ghi ra)
 * → { passed: [...], failed: [...] }, mỗi test kèm ảnh chụp / video / trace.
 */
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

  // đường dẫn tuyệt đối → URL /results/<env>/... (chỉ file nằm trong test-results/<env>)
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
          // giải thích lỗi bằng tiếng Việt (xem explain-error.js)
          explain: r.status === 'passed' ? null : explainError(
            stripAnsi((r.errors ?? []).map((e) => e.message).join('\n\n')),
            (() => {
              const ctx = att.find((a) => a.name === 'error-context')?.path;
              try { return ctx ? fs.readFileSync(ctx, 'utf8') : ''; } catch { return ''; }
            })(),
          ),
          images: att
            .filter((a) => a.contentType?.startsWith('image/') && a.path)
            .map((a) => ({ name: a.name === 'screenshot' ? 'Màn hình cuối' : a.name, url: toUrl(a.path) }))
            .filter((a) => a.url),
          // testInfo.attach(name, { body, contentType: 'text/plain' }) → JSON reporter lưu body dạng base64
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
  // bỏ tiêu đề cấp file (đã có trong location)
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
  if (req.method === 'GET' && pathname.startsWith('/component/')) {
    return serveFile(res, path.join(__dirname, 'component'), pathname.slice('/component/'.length));
  }
  // /report/dev/…  → playwright-report/dev   |   /results/dev/… → test-results/dev
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

/**
 * Tự load lại: sửa index.html / component → trang tự F5.
 * (Sửa server.js → `node --watch` trong lệnh `npm run panel` tự khởi động lại server,
 *  tab đang mở tự kết nối lại rồi F5.)
 */
const reloadClients = new Set();

function liveReload(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 500\n\n'); // mất kết nối (server restart) → thử lại sau 0,5s
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
  // Chỉ mở trình duyệt nếu chưa có tab nào kết nối lại (tránh mở tab mới mỗi lần server restart)
  setTimeout(() => {
    if (reloadClients.size) return;
    const opener = process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(opener);
  }, 1500);
});
