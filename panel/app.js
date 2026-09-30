const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const icon = (name) => { const i = document.createElement('i'); i.dataset.lucide = name; return i; };
const env = () => document.querySelector('input[name=env]:checked').value;
const logEl = $('#log');
const statusEl = $('#status');

const prefs = {
  get(key) { try { return JSON.parse(localStorage.getItem(`panel-${key}`) || 'null'); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`panel-${key}`, JSON.stringify(value)); } catch {} },
};

const envListeners = [];
const ctx = {
  $, $$, el, icon, env, prefs,
  refreshIcons: () => lucide.createIcons(),
  onEnvChange: (fn) => envListeners.push(fn),
  showGroup: (name) => showGroup(name),
  showTab: (name) => showTab(name),
  appendLog: (text) => appendLog(text),
};

const tabs = {};
async function loadTabs() {
  await Promise.all($$('.side .group[data-group]').map(async (group) => {
    const name = group.dataset.group;
    try {
      const res = await fetch(`/tabs/${name}/tab.html`);
      if (!res.ok) throw new Error(`thiếu file panel/tabs/${name}/tab.html`);
      group.innerHTML = await res.text();
    } catch (e) {
      group.replaceChildren(el('div', { className: 'card' }, [el('h2', { textContent: `Không nạp được tab "${name}"` }), el('p', { textContent: e.message })]));
      return;
    }
    try {
      tabs[name] = (await import(`/tabs/${name}/tab.js`)).default ?? {};
    } catch (e) {
      tabs[name] = {}; // tab không có tab.js (hoặc tab.js lỗi → xem console)
      if (!/404|Failed to fetch dynamically/.test(e.message)) console.error(`tabs/${name}/tab.js:`, e);
    }
  }));
}
/** Tìm hàm collect / after của 1 lệnh trong các tab */
const hook = (kind, action) => Object.values(tabs).map((t) => t[kind]?.[action]).find(Boolean);

await loadTabs();
lucide.createIcons();
const runButtons = $$('[data-run]');

// ---------- tuỳ chọn chung: môi trường, tốc độ ----------
const saved = prefs.get('main') ?? {};
if (saved.env) document.querySelector(`input[name=env][value=${saved.env}]`).checked = true;
if (saved.slowMo != null) $('#slowmo').setAttribute('value', saved.slowMo);
const saveMain = () => prefs.set('main', { env: env(), slowMo: $('#slowmo').value ?? $('#slowmo').getAttribute('value') });
$('#slowmo').addEventListener('change', saveMain);
$$('input[name=env]').forEach((r) => r.addEventListener('change', () => { saveMain(); envListeners.forEach((fn) => fn(env())); }));

// ---------- trạng thái chạy + tự tải lại khi sửa code ----------
function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = 'badge ' + (cls || ''); }
let isRunning = false, reloadPending = false;
function setRunning(running) {
  isRunning = running;
  runButtons.forEach((b) => (b.disabled = running));
  $('#stop').disabled = !running;
  if (!running && reloadPending) location.reload();
}
const requestReload = () => (isRunning ? (reloadPending = true) : location.reload());
let lostConnection = false;
const live = new EventSource('/livereload');
live.onmessage = (e) => e.data === 'reload' && requestReload();
live.onerror = () => (lostConnection = true);
live.onopen = () => lostConnection && requestReload();

function appendLog(text) {
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  for (const line of text.split(/(\n)/)) {
    if (line === '\n') { logEl.append('\n'); continue; }
    if (!line) continue;
    const span = document.createElement('span');
    if (/^\$ /.test(line)) span.className = 'cmd';
    else if (/^\s*⚠/.test(line)) span.className = 'warn-line';
    else if (/✔|✓|^\s*ok \d|\bpassed\b/.test(line)) span.className = 'ok';
    else if (/✘|^\s*x \d|\bfailed\b|Error|\d+\)\s\[/.test(line)) span.className = 'fail';
    span.textContent = line;
    logEl.append(span);
  }
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}
 
// ---------- chạy lệnh ----------
async function run(action) {
  const body = { action, env: env(), headed: $('#headed').checked, slowMo: Number($('#slowmo').value) };
  const collect = hook('collect', action);
  if (collect && (await collect(body, ctx)) === false) return;

  logEl.textContent = '';
  setRunning(true);
  setStatus('Đang chạy…', 'running');

  let exit = null;
  try {
    const res = await fetch('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      appendLog('✘ ' + (err.error || res.statusText) + '\n');
      ui.toast(err.error || res.statusText, 'error');
      setStatus('Lỗi', 'fail');
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let chunk = decoder.decode(value, { stream: true });
      const m = chunk.match(/\n__EXIT__(\S+)\n$/);
      if (m) { exit = m[1]; chunk = chunk.slice(0, m.index); }
      appendLog(chunk);
    }
    const logText = logEl.textContent;
    const allSkipped = /\d+ skipped/.test(logText) && !/\d+ passed/.test(logText) && !/\d+ failed/.test(logText);
    const warned = /^\s*⚠/m.test(logText);
    if (exit === '0' && allSkipped) {
      setStatus('Bị bỏ qua ⚠', 'running');
      appendLog('\n⚠ Không có test nào chạy — xem dòng "Bỏ qua…" ở đầu log (thường do chưa điền tài khoản trong env).\n');
      ui.toast('Không có test nào chạy — xem đầu log', 'info');
    } else if (exit === '0') {
      setStatus(warned ? 'Xong, có cảnh báo ⚠' : 'Xong ✔', warned ? 'running' : 'ok');
      ui.toast(warned ? 'Chạy xong — đạt, nhưng có cảnh báo (dòng ⚠ màu vàng)' : 'Chạy xong, tất cả đều đạt', warned ? 'info' : 'success');
    } else if (exit === 'stopped' || exit === null) { setStatus('Đã dừng', ''); ui.toast('Đã dừng', 'info'); }
    else { setStatus('Có lỗi ✘', 'fail'); ui.toast('Có test bị lỗi — xem tab Lỗi', 'error'); }

    hook('after', action)?.(exit, body, ctx);
  } catch (e) {
    appendLog('\n✘ Mất kết nối tới server: ' + e.message + '\n');
    setStatus('Lỗi', 'fail');
    ui.toast('Mất kết nối tới server', 'error');
  } finally {
    setRunning(false);
    // Chạy xong → có lỗi thì mở tab Lỗi, không thì mở tab Thành công (xem ảnh)
    const results = await loadResults();
    if (results.failed.length && exit !== '0') showTab('failed');
    else if (exit === '0' && results.passed.length) showTab('passed');
  }
}

// ---------- menu nhóm chức năng (cột trái) — tự sinh từ các .group, có tìm kiếm ----------
const groups = $$('.side .group');
const menuList = $('#menu-list');
const searchInput = $('#menu-search');
// bỏ dấu tiếng Việt để tìm "khoa" ra "khoá"
const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
let activeGroup = null;

function buildMenu() {
  menuList.replaceChildren(...groups.map((g) => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.dataset.group = g.dataset.group;
    btn.innerHTML = `<i data-lucide="${g.dataset.icon || 'folder'}"></i><span class="label"></span>`;
    btn.querySelector('.label').textContent = g.dataset.label || g.dataset.group;
    btn.title = btn.querySelector('.label').textContent;
    btn.addEventListener('click', () => { searchInput.value = ''; applySearch(); showGroup(g.dataset.group); });
    return btn;
  }));
  lucide.createIcons();
}

function showGroup(name) {
  if (!groups.some((g) => g.dataset.group === name)) name = groups[0]?.dataset.group;
  activeGroup = name;
  menuList.querySelectorAll('.menu-item').forEach((m) => m.classList.toggle('active', m.dataset.group === name));
  groups.forEach((g) => (g.hidden = g.dataset.group !== name));
  prefs.set('group', name);
}

/** Tìm theo tên nhóm + tiêu đề/mô tả của từng chức năng. Có từ khoá → hiện mọi nhóm có kết quả */
function applySearch() {
  const q = norm(searchInput.value.trim());
  $('.side').classList.toggle('searching', !!q);
  let anyMatch = false;
  for (const g of groups) {
    const cards = [...g.querySelectorAll(':scope > .card')];
    const groupHit = q && norm(g.dataset.label || '').includes(q);
    let hits = 0;
    for (const c of cards) {
      const hit = !q || groupHit || norm(c.querySelector('h2')?.textContent + ' ' + (c.querySelector('p')?.textContent ?? '')).includes(q);
      c.hidden = !hit;
      if (hit) hits++;
    }
    const item = menuList.querySelector(`[data-group="${g.dataset.group}"]`);
    item.hidden = !!q && hits === 0;
    if (q) g.hidden = hits === 0;
    anyMatch ||= hits > 0;
  }
  menuList.querySelector('.menu-empty')?.remove();
  if (q && !anyMatch) menuList.append(el('div', { className: 'menu-empty', textContent: 'Không tìm thấy chức năng nào' }));
  if (q) menuList.querySelectorAll('.menu-item').forEach((m) => m.classList.remove('active'));
  else showGroup(activeGroup);
}

searchInput.addEventListener('input', applySearch);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchInput.value = ''; applySearch(); searchInput.blur(); } });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
});

// ---------- tab Log / Thành công / Lỗi ----------
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  logEl.hidden = name !== 'log';
  $('#passed').hidden = name !== 'passed';
  $('#failed').hidden = name !== 'failed';
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

/** Lấy kết quả lần chạy gần nhất (theo môi trường đang chọn), vẽ ra tab Thành công + Lỗi */
async function loadResults() {
  let results = { passed: [], failed: [] };
  try { results = await (await fetch('/results?env=' + env())).json(); } catch {}
  $('#pass-count').textContent = results.passed.length;
  $('#pass-count').classList.toggle('ok', results.passed.length > 0);
  $('#fail-count').textContent = results.failed.length;
  $('#fail-count').classList.toggle('has', results.failed.length > 0);
  renderResults($('#passed'), results.passed, 'passed');
  renderResults($('#failed'), results.failed, 'failed');
  lucide.createIcons();
  return results;
}

function renderResults(box, items, kind) {
  box.replaceChildren();
  if (!items.length) {
    box.append(el('div', { className: 'empty' }, [
      icon(kind === 'passed' ? 'image-off' : 'circle-check'),
      kind === 'passed' ? `Lần chạy gần nhất trên ${env()} chưa có test thành công.` : `Lần chạy gần nhất trên ${env()} không có test lỗi.`,
    ]));
  }
  for (const f of items) {
    const secs = (f.duration / 1000).toFixed(1);
    const card = el('div', { className: `result-card ${kind}` }, [
      el('h3', {}, [
        icon(kind === 'passed' ? 'circle-check' : 'circle-x'),
        f.name,
        // test đạt nhưng có dòng ⚠ → nhãn vàng "Có cảnh báo"
        ...((f.notes ?? []).some((n) => /^\s*⚠/m.test(n.text)) ? [el('span', { className: 'warn-text', textContent: '⚠ Có cảnh báo' })] : []),
      ]),
      el('div', { className: 'loc' }, [`${f.location} · ${f.project} · ${secs}s`]),
    ]);
    if (f.explain) {
      const x = f.explain;
      card.append(el('div', { className: 'explain' }, [
        el('div', { className: 'what' }, [icon('circle-alert'), el('span', { textContent: x.what })]),
        ...(x.screen ? [el('div', { className: 'screen' }, [icon('monitor'), el('span', { textContent: x.screen })])] : []),
        ...(x.api ?? []).map((line) => el('div', { className: 'api' }, [icon('server-crash'), el('span', { textContent: `Server trả lỗi: ${line}` })])),
        el('div', { className: 'todo' }, [icon('lightbulb'), el('span', { textContent: x.todo })]),
      ]));
    }
    if (f.error) {
      // log gốc của Playwright: thu gọn, bấm để xem
      const raw = el('details', { className: 'raw' }, [el('summary', { textContent: 'Chi tiết kỹ thuật (log gốc)' }), el('pre', { textContent: f.error })]);
      if (!f.explain) raw.open = true;
      card.append(raw);
    }
    for (const n of f.notes ?? []) {
      // mỗi dòng: ✔ xanh / ✘ đỏ / ⚠ vàng
      card.append(el('div', { className: 'notes' }, n.text.split('\n').map((line) =>
        el('div', { className: /^\s*✘/.test(line) ? 'bad' : /^\s*⚠/.test(line) ? 'warn-line' : /^\s*✔/.test(line) ? 'good' : '', textContent: line || ' ' }))));
    }
    if (f.images.length) {
      card.append(el('div', { className: 'shots' }, f.images.map((img) =>
        el('figure', { className: 'shot' }, [
          el('img', { src: img.url, loading: 'lazy', title: 'Bấm để phóng to' }),
          el('figcaption', { textContent: img.name }),
        ]))));
    }
    const links = el('div', { className: 'links' });
    if (f.video) {
      const btn = el('button', { type: 'button' }, [icon('video'), 'Xem video']);
      btn.onclick = () => { btn.replaceWith(el('video', { src: f.video, controls: true, autoplay: true })); };
      links.append(btn);
    }
    if (f.trace) {
      const viewer = `/report/${env()}/trace/index.html?trace=${encodeURIComponent(location.origin + f.trace)}`;
      links.append(el('a', { href: viewer, target: '_blank', title: 'Xem lại từng bước, có ảnh mỗi thao tác' }, [icon('footprints'), 'Xem trace']));
      links.append(el('a', { href: f.trace, download: '' }, [icon('download'), 'Tải trace.zip']));
    }
    if (links.children.length) card.append(links);
    box.append(card);
  }
}

// Bấm ảnh → phóng to
$$('.result-pane').forEach((pane) => pane.addEventListener('click', (e) => {
  if (e.target.matches('.shots img')) { $('#lightbox img').src = e.target.src; $('#lightbox').hidden = false; }
}));
$('#lightbox').addEventListener('click', () => ($('#lightbox').hidden = true));
document.addEventListener('keydown', (e) => e.key === 'Escape' && ($('#lightbox').hidden = true));
ctx.onEnvChange(loadResults);

// ---------- khởi động ----------
for (const [name, tab] of Object.entries(tabs)) {
  try { tab.init?.(ctx); } catch (e) { console.error(`Tab "${name}" lỗi khi khởi động:`, e); }
}
buildMenu();
showGroup(prefs.get('group'));
applySearch();
loadResults();

runButtons.forEach((b) => b.addEventListener('click', () => run(b.dataset.run)));
$('#stop').addEventListener('click', () => fetch('/stop', { method: 'POST' }));
$('#clear').addEventListener('click', () => { logEl.textContent = ''; });
$('#seller-sync').addEventListener('click', async () => {
  const btn = $('#seller-sync');
  btn.disabled = true;
  btn.classList.add('syncing');
  try {
    const { syncSeller } = await import('/component/shared/seller-sync.js');
    const { total, errors } = await syncSeller(env());
    if (errors.length) ui.toast(`Đồng bộ lỗi — ${errors.join('; ')}`, 'error');
    else ui.toast(`Đã đồng bộ ${total} nguồn dữ liệu từ Seller (${env()})`, 'success');
  } finally {
    btn.disabled = false;
    btn.classList.remove('syncing');
  }
});
$('#ui').addEventListener('click', () => fetch('/ui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env: env() }) }));
fetch('/status').then((r) => r.json()).then((s) => { if (s.running) { setRunning(true); setStatus('Đang chạy (lệnh cũ)…', 'running'); } });
