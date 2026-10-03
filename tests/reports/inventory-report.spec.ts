import { Locator, Page, Response, TestInfo } from '@playwright/test';
import { expect, test as base } from '../shared-page';
import { PosProduct, findOnPos, openPos, sell } from '../pos';
import { cancelTestOrder } from '../orders';
import { autoDismissSecurityPopup } from '../../pages/common';

/**
 * Kiểm tra trang Báo cáo tồn kho (/reports/inventory), thao tác trên giao diện như người dùng, mỗi phần 1 test kèm ảnh:
 *   1.     4 card tổng — nhãn, (i), số hiển thị; so với bảng và trang Quản lý kho
 *   2–3.   Top 10 bán chạy / chậm tiêu thụ
 *   4–6.   Bảng Tồn kho theo cửa hàng: số liệu, bộ lọc, Xem chi tiết → Tồn kho theo sản phẩm (bảng + xuất file)
 *   7.     Bộ lọc thời gian (mặc định 1 tháng, chọn nhanh, không cho chọn tương lai)
 *   8.     Tạo đơn bán tại quầy → trang tự cập nhật (realtime) → huỷ đơn → tồn kho cộng lại
 *
 * Khoảng ngày: mặc định của trang (1 tháng gần nhất). Đổi bằng INVENTORY_FROM / INVENTORY_TO (YYYY-MM-DD).
 */

const TOLERANCE = 1;
const ENV_FROM = process.env.INVENTORY_FROM || '';
const ENV_TO = process.env.INVENTORY_TO || '';
const CREATE_ORDER = process.env.INVENTORY_CREATE_ORDER !== '0';
const CANCEL_ORDER = process.env.INVENTORY_CANCEL_ORDER !== '0';
const ORDER_PRODUCT = (process.env.INVENTORY_ORDER_PRODUCT || '').trim();
const ORDER_PRODUCT_ID = Number(process.env.INVENTORY_ORDER_PRODUCT_ID) || undefined;

const SUMMARY = 'reports/inventory/overview/summary';
const TOP = 'reports/inventory/overview/top-selling';
const SLOW = 'reports/inventory/overview/slow-moving';
const TABLE = 'reports/inventory/store/report';

const TOP_SIZE = 10;
const LOW_STOCK = 5;
const SLOW_DAYS = 30;
const PRESETS = ['Hôm nay', 'Hôm qua', 'Tuần này', 'Tháng này', 'Năm nay'];

// (i) theo thiết kế; keys = chữ bắt buộc phải có trong (i)
const CARDS = [
  { labels: ['Giá trị tồn kho'], key: 'stockValue', hint: 'Tổng giá trị vốn hàng hoá/dịch vụ hiện đang có tại kho', keys: ['vốn', 'kho'] },
  { labels: ['Số lượng tồn kho'], key: 'stockQuantity', hint: 'Tổng số lượng vốn hàng hoá/dịch vụ hiện đang có tại kho', keys: ['số lượng', 'kho'] },
  { labels: ['Số lượng sắp hết hàng'], key: 'lowStockProducts', hint: 'Tổng số lượng sản phẩm có hàng tồn kho dưới 5', keys: ['tồn kho', '5'] },
  // AC ghi "Hàng chậm tiêu thụ", thiết kế ghi "Tồn kho quá hạn" → nhận cả 2
  { labels: ['Tồn kho quá hạn', 'Hàng chậm tiêu thụ'], key: 'slowMovingProducts', hint: 'Tổng chi phí để nhập/sản xuất ra sản phẩm/dịch vụ', keys: ['chi phí'] },
] as const;

interface Range { from: string; to: string }
interface NumFmt { decimal: string; thousand: string }

// ---------- tiện ích ----------

const money = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const qtyText = (v: number) => (v ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const sum = <T>(rows: T[] | undefined, f: (r: T) => number) => (rows ?? []).reduce((s, r) => s + Number(f(r) ?? 0), 0);
const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
// so (i) không phân biệt "hoá" / "hóa"
const loose = (s: string) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^\p{L}\d<>]+/gu, '');
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const vnDate = (iso: string) => iso.split('-').reverse().join('/');
const dotDate = (iso: string) => iso.split('-').reverse().join('.');
const today = () => isoOf(new Date());
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoOf(new Date(y, m - 1, d + n));
};
// giống FE: lùi 1 tháng, giữ ngày (ngày 31 → ngày cuối tháng trước)
const monthAgo = () => {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  target.setDate(Math.min(now.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
  return isoOf(target);
};
/** Khoảng ngày đúng của nút chọn nhanh (tuần bắt đầu thứ Hai) */
function presetRange(name: string): Range | null {
  const t = today();
  const [y, m, d] = t.split('-').map(Number);
  const now = new Date(y, m - 1, d);
  const first = (yy: number, mm: number) => isoOf(new Date(yy, mm, 1));
  switch (norm(name)) {
    case 'hôm nay': return { from: t, to: t };
    case 'hôm qua': return { from: addDays(t, -1), to: addDays(t, -1) };
    case 'tuần này': return { from: addDays(t, -((now.getDay() + 6) % 7)), to: t };
    case 'tháng này': return { from: first(y, m - 1), to: t };
    case 'năm nay': return { from: first(y, 0), to: t };
    case '7 ngày qua': return { from: addDays(t, -6), to: t };
    case 'tháng trước': return { from: first(y, m - 2), to: isoOf(new Date(y, m - 1, 0)) };
    case 'quý này': return { from: first(y, Math.floor((m - 1) / 3) * 3), to: t };
    default: return null;
  }
}
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

/** Số theo vi-VN (biểu đồ, card, tooltip): "1.234", "2,5", "1.234.567đ" */
const parseVi = (text: string) => parseWith(text, { decimal: ',', thousand: '.' });

function parseWith(text: string, f: NumFmt): number {
  let s = (text ?? '').replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return 0;
  s = s.split(f.thousand).join('');
  if (f.decimal !== '.') s = s.replace(f.decimal, '.');
  return Number(s) || 0;
}

/** Rule tiền rút gọn: <1.000 → đ | k | tr | T, 1 chữ số thập phân (chữ số thứ 2 ≥ 5 làm tròn lên), thập phân 0 thì ẩn */
function ruleCompact(v: number, f: NumFmt): string {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs < 1_000) return `${sign}${Math.round(abs)}đ`;
  const [div, unit] = abs >= 1e9 ? [1e9, 'T'] : abs >= 1e6 ? [1e6, 'tr'] : [1e3, 'k'];
  const hundredths = Math.floor(Math.round((abs * 100 * 1e6) / div) / 1e6);
  const tenths = Math.floor(hundredths / 10) + (hundredths % 10 >= 5 ? 1 : 0);
  const int = String(Math.floor(tenths / 10)).replace(/\B(?=(\d{3})+(?!\d))/g, f.thousand);
  const dec = tenths % 10;
  return `${sign}${int}${dec ? f.decimal + dec : ''}${unit}`;
}
const sameCompact = (a: string, b: string) => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();

async function readFmt(page: Page): Promise<NumFmt> {
  const cfg = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('number_format_config') || 'null');
    } catch {
      return null;
    }
  });
  return { decimal: cfg?.decimalSeparator || '.', thousand: cfg?.thousandSeparator ?? ',' };
}

async function settle(target: Locator) {
  await target.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await target.page().waitForTimeout(300);
}

// ---------- ghi nhận API trang gọi ----------

interface WaitOpt {
  range?: Range;
  params?: Record<string, string | string[]>;
  pred?: (u: URL) => boolean;
  since?: number;
  timeout?: number;
}

const hasNone = (keys: string[]) => (u: URL) => !keys.some((k) => u.searchParams.has(k));

class ApiLog {
  private items: { url: URL; status: number; json: Promise<any> }[] = [];
  private onResponse = (r: Response) => {
    const url = r.url();
    if (r.request().method() !== 'GET' || !url.includes('/reports/inventory/') || url.includes('/stream')) return;
    this.items.push({ url: new URL(url), status: r.status(), json: r.json().catch(() => null) });
  };

  constructor(private page: Page) {
    page.on('response', this.onResponse);
  }

  dispose() {
    this.page.off('response', this.onResponse);
  }

  mark() {
    return this.items.length;
  }

  private matcher(path: string, opt: WaitOpt) {
    const { range, params = {}, pred } = opt;
    return (u: URL) =>
      u.pathname.endsWith('/' + path) &&
      (!range || (u.searchParams.get('startDate') === range.from && u.searchParams.get('endDate') === range.to)) &&
      Object.entries(params).every(([k, v]) =>
        Array.isArray(v)
          ? JSON.stringify(u.searchParams.getAll(k).sort()) === JSON.stringify([...v].sort())
          : (u.searchParams.get(k) ?? (k === 'page' ? '1' : null)) === v,
      ) &&
      (!pred || pred(u));
  }

  /** có lời gọi khớp sau mốc `since` không (không chờ) */
  calls(path: string, opt: WaitOpt = {}) {
    const ok = this.matcher(path, opt);
    return this.items.slice(opt.since ?? 0).filter((c) => ok(c.url));
  }

  async firstRange(path: string, since = 0): Promise<Range> {
    const find = () => this.items.slice(since).find((c) => c.url.pathname.endsWith('/' + path));
    await expect.poll(() => Boolean(find()), { message: `Trang không gọi API ${path}`, timeout: 20_000 }).toBe(true);
    const { searchParams } = find()!.url;
    return { from: searchParams.get('startDate')!, to: searchParams.get('endDate')! };
  }

  async wait(path: string, opt: WaitOpt = {}): Promise<any> {
    const ok = this.matcher(path, opt);
    const match = () => this.items.slice(opt.since ?? 0).findLast((c) => ok(c.url));
    await expect
      .poll(() => Boolean(match()), {
        message: `Trang không gọi API ${path}${opt.range ? ` (${opt.range.from} → ${opt.range.to})` : ''}`,
        timeout: opt.timeout ?? 20_000,
      })
      .toBe(true);
    const hit = match()!;
    expect(hit.status, `API ${path} trả lỗi ${hit.status}`).toBe(200);
    return hit.json;
  }
}

class Report {
  private lines: string[] = [];
  private shotNo = 0;

  constructor(public page: Page, private info: TestInfo) {}

  note(text: string) {
    this.lines.push(text);
  }

  check(ok: boolean, label: string, detail = '') {
    this.lines.push(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
    expect.soft(ok, `${label}${detail ? ` — ${detail}` : ''}`).toBe(true);
  }

  warn(label: string, detail = '') {
    this.lines.push(`⚠ ${label}${detail ? ` — ${detail}` : ''}`);
    this.info.annotations.push({ type: 'warning', description: `${label}${detail ? ` — ${detail}` : ''}` });
  }

  /** So 2 số; `unit` = 'đ' → hiện dạng tiền */
  same(label: string, actual: number, expected: number, expectedLabel: string, unit: 'đ' | '' = '') {
    const show = (v: number) => (unit ? money(v) : qtyText(v));
    const diff = actual - expected;
    const ok = Math.abs(diff) <= (unit ? TOLERANCE : 0.001);
    this.lines.push(`${ok ? '✔' : '✘'} ${label}: ${show(actual)}${ok ? '' : ` ≠ ${expectedLabel} ${show(expected)} (lệch ${show(diff)})`}`);
    expect.soft(ok, `${label}: ${show(actual)} ≠ ${expectedLabel} ${show(expected)} (lệch ${show(diff)})`).toBe(true);
  }

  async shot(name: string, target?: Locator | 'viewport') {
    const file = this.info.outputPath(`${String(++this.shotNo).padStart(2, '0')}-${name.replace(/[^\p{L}\d]+/gu, '-')}.png`);
    await this.page.waitForTimeout(400);
    if (target === 'viewport') await this.page.screenshot({ path: file });
    else if (target) await target.screenshot({ path: file });
    else await this.page.screenshot({ path: file, fullPage: true });
    await this.info.attach(name, { path: file, contentType: 'image/png' });
  }

  async flush() {
    if (!this.lines.length) return;
    const body = this.lines.join('\n');
    console.log(`\n[${this.info.title}]\n${body}`);
    await this.info.attach('Kết quả', { body, contentType: 'text/plain' });
  }
}

const test = base.extend<{ api: ApiLog; report: Report }>({
  api: async ({ page }, use) => {
    const api = new ApiLog(page);
    await use(api);
    api.dispose();
  },
  report: async ({ page }, use, testInfo) => {
    const report = new Report(page, testInfo);
    await use(report);
    await report.flush();
  },
});

// ---------- vùng trên trang ----------

const cardOf = (page: Page, label: string) => page.locator('.dash-card').filter({ hasText: new RegExp(label, 'i') }).first();
const tableCard = (page: Page) => page.locator('.dash-card').filter({ hasText: 'Tồn Kho Theo Cửa Hàng' }).filter({ has: page.locator('table') }).first();
const topCard = (page: Page, title: string) => page.locator('.dash-card').filter({ hasText: title }).first();
/** Tiêu đề card Top 10 */
const topHeader = (card: Locator, title: string) => card.getByText(title).first();

/** Gõ ngày vào ô amf-daterange (ô chia phần dd/mm/yyyy) */
async function typeDate(page: Page, index: 0 | 1, iso: string) {
  const input = page.locator('amf-daterange input').nth(index);
  await input.focus();
  await input.press('ArrowLeft');
  await input.press('ArrowLeft');
  await input.pressSequentially(vnDate(iso).replace(/\//g, ''));
  await expect(input, `Không gõ được ngày ${vnDate(iso)}`).toHaveValue(vnDate(iso));
}

async function setRange(page: Page, range: Range, current: Range) {
  if (range.from === current.from && range.to === current.to) return;
  const steps: [0 | 1, string][] = range.from > current.to ? [[1, range.to], [0, range.from]] : [[0, range.from], [1, range.to]];
  for (const [i, iso] of steps) await typeDate(page, i, iso);
  await page.keyboard.press('Escape');
}

interface Overview {
  range: Range;
  summary: any;
  top: any[];
  slow: any[];
  since: number;
}

async function openOverview(page: Page, api: ApiLog, report: Report, opt: { defaultRange?: boolean; quiet?: boolean } = {}): Promise<Overview> {
  const since = api.mark();
  await page.goto('/reports/inventory');
  await expect(page, 'Bị chuyển về trang đăng nhập — phiên hết hạn?').not.toHaveURL(/\/auth\//);
  await expect(page, 'Không có quyền xem Báo cáo tồn kho').not.toHaveURL(/\/errors\/|approval-required/);

  const def = await api.firstRange(SUMMARY, since);
  const range: Range = opt.defaultRange ? def : { from: ENV_FROM || def.from, to: ENV_TO || def.to };
  await setRange(page, range, def);

  const [summary, top, slow] = await Promise.all([
    api.wait(SUMMARY, { range, since }),
    api.wait(TOP, { range, since }),
    api.wait(SLOW, { range, since }),
  ]);
  expect(summary?.data, 'API card tổng không trả dữ liệu').toBeTruthy();
  for (const label of ['Giá trị tồn kho', 'Số lượng tồn kho']) await expect(cardOf(page, label).locator('.animate-pulse')).toHaveCount(0);
  if (!opt.quiet) {
    report.note(`Khoảng ngày: ${vnDate(range.from)} → ${vnDate(range.to)}`);
    report.note('');
  }
  return { range, summary: summary.data, top: top?.data?.items ?? [], slow: slow?.data?.items ?? [], since };
}

// ---------- bảng tồn kho theo cửa hàng ----------

interface TableRow { name: string; productCount: string; stockValue: string; slowCount: string; slowValue: string }

async function tableRows(page: Page): Promise<TableRow[]> {
  return tableCard(page).evaluate((card) =>
    [...card.querySelectorAll('tbody tr')]
      .filter((tr) => !tr.querySelector('td[colspan]') && tr.children.length >= 5)
      .map((tr) => {
        const c = [...tr.children].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim());
        return { name: c[0], productCount: c[1], stockValue: c[2], slowCount: c[3], slowValue: c[4] };
      }),
  );
}

/** Đọc bảng qua mọi trang (chụp từng trang); trả dữ liệu API + chữ trên màn hình */
async function readTable(page: Page, api: ApiLog, report: Report, opt: { since: number; params?: Record<string, string | string[]>; pred?: (u: URL) => boolean; title?: string; shots?: boolean }) {
  const card = tableCard(page);
  const items: any[] = [];
  const rows: TableRow[] = [];
  let total = 0;
  let since = opt.since;
  for (let pageNo = 1; ; pageNo++) {
    const body = await api.wait(TABLE, { params: { ...opt.params, page: String(pageNo) }, pred: opt.pred, since });
    const pageItems: any[] = body?.items ?? [];
    total = Number(body?.total ?? pageItems.length);
    items.push(...pageItems);
    await expect
      .poll(async () => (await tableRows(page)).length, { message: `Bảng Tồn Kho Theo Cửa Hàng trang ${pageNo} không hiện đủ ${pageItems.length} dòng` })
      .toBe(pageItems.length);
    rows.push(...(await tableRows(page)));
    if (opt.shots !== false) {
      // bảng có khung cuộn riêng (max-h-120) → mở hết chiều cao để ảnh thấy đủ dòng
      await card.locator('table').evaluate((t) => {
        for (let el = t.parentElement; el && !el.classList.contains('dash-card'); el = el.parentElement) {
          if (getComputedStyle(el).overflowY !== 'visible') el.style.maxHeight = 'none';
        }
      });
      await report.shot(`${opt.title ?? 'Bảng tồn kho theo cửa hàng'} — trang ${pageNo}`, card);
    }
    const next = card.getByTitle('Trang sau');
    if (!(await next.isVisible().catch(() => false))) break;
    since = api.mark();
    await next.click();
  }
  return { items, rows, total };
}

/** Chọn / bỏ chọn mục trong amf-select (bấm "Chọn" để áp dụng) */
async function toggleOptions(select: Locator, names: string[]) {
  const page = select.page();
  const trigger = select.locator('button').first();
  const panel = page
    .locator('div.fixed:visible')
    .filter({ has: page.getByRole('button', { name: 'Chọn', exact: true }) })
    .last();
  for (let attempt = 0; attempt < 3 && !(await panel.isVisible()); attempt++) {
    await settle(trigger);
    await trigger.click();
    await panel.waitFor({ timeout: 2_000 }).catch(() => {});
  }
  await expect(panel, 'Không mở được ô chọn').toBeVisible();
  const search = panel.getByPlaceholder('Tìm kiếm...');
  const searchable = await search.isVisible().catch(() => false);
  for (const name of names) {
    if (searchable) await search.fill(name);
    const option = panel.getByRole('button', { name, exact: true }).first();
    await expect(option, `Ô chọn không có "${name}"`).toBeAttached();
    await option.evaluate((b: HTMLElement) => b.click());
  }
  // ô chọn ở cuối trang: danh sách dài đẩy nút "Chọn" ra ngoài màn hình, cuộn tới thì khung chạy theo → bấm thẳng nút
  await panel.getByRole('button', { name: 'Chọn', exact: true }).evaluate((b: HTMLElement) => b.click());
  await expect(panel).toBeHidden();
}

const storeSelect = (scope: Locator) => scope.locator('amf-select').filter({ has: scope.page().locator('label', { hasText: 'Chọn Cửa Hàng' }) }).first();
const statusSelect = (scope: Locator) => scope.locator('amf-select').filter({ has: scope.page().locator('label', { hasText: 'Trạng Thái Cửa Hàng' }) }).first();

/** Tên cửa hàng không trùng nhau (để chọn trong ô lọc theo tên) */
const uniqueNames = (items: { storeName: string }[]) => {
  const count = new Map<string, number>();
  for (const it of items) count.set(norm(it.storeName), (count.get(norm(it.storeName)) ?? 0) + 1);
  return items.filter((it) => it.storeName?.trim() && count.get(norm(it.storeName)) === 1);
};

async function hoverTooltip(page: Page, target: Locator, hasText: string) {
  const tip = page.getByRole('tooltip').filter({ hasText });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.move(0, 0);
    await settle(target);
    await target.hover();
    const text = await tip.first().textContent({ timeout: 2_000 }).catch(() => null);
    if (text) return text.replace(/\s+/g, ' ').trim();
  }
  return null;
}

/** Số sau nhãn trong tooltip: "Số lượng bán: 12" */
const tipValue = (text: string, label: string) => {
  const m = text.match(new RegExp(`(?:${label})\\s*:?\\s*([-\\d.,]+)`));
  return m ? parseVi(m[1]) : NaN;
};

/** Tooltip "Số lượng tồn": SP không quản lý tồn ghi "Không giới hạn" (API trả 0), còn lại so số với API */
function checkTipStock(report: Report, tip: string, it: any) {
  const m = tip.match(/Số lượng tồn\s*:?\s*([^\d\s-][^:]*?)(?=Doanh thu|Số lượng|$)/);
  if (m && isInfinite(m[1])) {
    report.check(Number(it.stockQuantity) === 0, 'Tooltip — số lượng tồn: "Không giới hạn" (sản phẩm không quản lý tồn kho)', `API ${qtyText(it.stockQuantity)}`);
    return;
  }
  report.same('Tooltip — số lượng tồn', tipValue(tip, 'Số lượng tồn'), Number(it.stockQuantity), 'API');
}

// ---------- top 10 ----------

async function openTop(page: Page, title: string) {
  const card = topCard(page, title);
  await settle(topHeader(card, title));
  const chart = card.locator('.top-chart').or(card.getByText('Không có dữ liệu')).first();
  await expect(chart, `Card "${title}" không hiện biểu đồ`).toBeVisible();
  return card;
}

async function checkTopChart(page: Page, report: Report, title: string, items: any[], valueOf: (it: any) => number, range: Range) {
  const card = await openTop(page, title);
  const header = (await topHeader(card, title).innerText()).replace(/\s+/g, ' ');
  const want = `(Từ ${dotDate(range.from)} - ${dotDate(range.to)})`;
  report.check(header.includes(want), `Tiêu đề "${title}" ghi đúng khoảng ngày ${want}`, header);
  report.check(items.length <= TOP_SIZE, `Tối đa ${TOP_SIZE} sản phẩm`, `API trả ${items.length}`);

  if (!items.length) {
    await expect.soft(card.getByText('Không có dữ liệu'), `${title}: không có sản phẩm mà không hiện "Không có dữ liệu"`).toBeVisible();
    report.warn(`${title}: chưa có sản phẩm nào trong khoảng ngày`);
    await report.shot(title, card);
    return card;
  }

  const names = (await card.locator('.grid > div.flex.flex-col span.truncate').allTextContents()).map((t) => t.trim());
  const values = (await card.locator('.top-chart span.ml-2').allTextContents()).map((t) => t.trim());
  report.check(names.length === items.length, `Trục tung: ${items.length} tên sản phẩm`, `hiện ${names.length}`);
  const wrongName = items.map((it, i) => ({ want: it.productName, got: names[i] ?? '' })).filter((x) => norm(x.got) !== norm(x.want));
  report.check(!wrongName.length, 'Tên sản phẩm đúng thứ tự API', wrongName.slice(0, 5).map((x) => `"${x.got}" ≠ "${x.want}"`).join('; '));
  const wrongVal = items.map((it, i) => ({ it, got: values[i] ?? '' })).filter((x) => Math.abs(parseVi(x.got) - valueOf(x.it)) > 0.001);
  report.check(!wrongVal.length, 'Số cuối mỗi thanh đúng API', wrongVal.slice(0, 5).map((x) => `"${x.it.productName}": hiện "${x.got}", đúng ${qtyText(valueOf(x.it))}`).join('; '));
  const unsorted = items.findIndex((it, i) => i > 0 && valueOf(items[i - 1]) < valueOf(it));
  report.check(unsorted < 0, 'Sắp xếp giảm dần', unsorted < 0 ? '' : `"${items[unsorted].productName}" (${qtyText(valueOf(items[unsorted]))}) đứng sau "${items[unsorted - 1].productName}" (${qtyText(valueOf(items[unsorted - 1]))})`);
  await report.shot(title, card);
  return card;
}

// ---------- trang chi tiết Tồn kho theo sản phẩm ----------

/** Cột "Đã bán tại quầy" — trang ghi tắt "Đã Bán Tại BHTQ" (Bán hàng tại quầy) */
const POS_COL = 'tại quầy|BHTQ';
/** Sản phẩm không quản lý tồn kho: bảng chi tiết hiện icon ∞ (đọc thành "∞"), tooltip Top 10 ghi "Không giới hạn" */
const isInfinite = (text: string) => /∞|vô hạn|không giới hạn/i.test(text ?? '');

/** Đọc bảng trang chi tiết (đang mở): tiêu đề cột, các dòng trang đầu, tổng tồn bỏ ∞ */
async function readDetail(page: Page, fmt: NumFmt) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  const loaded = page.locator('tbody tr:not(:has(td[colspan]))').first().or(page.locator('app-table-empty')).first();
  if (!(await loaded.waitFor({ timeout: 20_000 }).then(() => true, () => false))) return null;
  const heads = (await page.locator('thead th').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const iStock = heads.findIndex((h) => /^Tồn kho/i.test(h));
  const cells = await page.locator('tbody tr').evaluateAll((trs) =>
    trs.filter((tr) => !tr.querySelector('td[colspan]')).map((tr) => [...tr.children].map((td) =>
      td.querySelector('.lucide-infinity, lucide-icon[name="infinity"]') ? '∞' : (td.textContent ?? '').replace(/\s+/g, ' ').trim())));
  const finite = iStock < 0 ? cells : cells.filter((c) => !isInfinite(c[iStock]));
  return {
    heads, cells, iStock,
    infinite: cells.length - finite.length,
    stockSum: iStock < 0 ? NaN : sum(finite, (c) => parseWith(c[iStock], fmt)),
    paged: await page.getByTitle('Trang sau').isVisible().catch(() => false),
  };
}

// ---------- trang Quản lý kho (đối chiếu) ----------

/**
 * Đọc tồn kho từng (cửa hàng, sản phẩm) ở trang Quản lý kho: mở trang, đổi lời gọi danh sách đầu tiên
 * thành "các cửa hàng cần so + còn hàng + 1 trang 1000 dòng" (chỉ để đọc, không đổi dữ liệu).
 */
async function readWarehouse(page: Page, report: Report, storeIds: number[]) {
  const isList = (url: string) => new URL(url).pathname.endsWith('/api/warehouse');
  await page.route(isList, async (route) => {
    const body = route.request().postDataJSON() ?? {};
    body.page = 1;
    body.pageSize = 1000;
    body.searchParams = { ...(body.searchParams ?? {}), storeIds, status: 1 };
    await route.continue({ postData: JSON.stringify(body) });
  });
  try {
    const res = page.waitForResponse((r) => isList(r.url()) && r.request().method() === 'POST', { timeout: 30_000 });
    await page.goto('/inventory/warehouse');
    await expect(page, 'Không vào được trang Quản lý kho').not.toHaveURL(/\/errors\/|\/auth\//);
    const body = await (await res).json().catch(() => null);
    const rows: any[] = body?.data ?? [];
    await page.waitForTimeout(800);
    await report.shot('Quản lý kho — các cửa hàng đối chiếu');
    return { rows, records: Number(body?.records ?? rows.length) };
  } finally {
    await page.unroute(isList);
  }
}

// ---------- kịch bản ----------

test.describe('Tồn kho', () => {
  test('1. Card thông tin tổng', async ({ page, api, report }) => {
    test.setTimeout(180_000);
    const ov = await openOverview(page, api, report);
    const s = ov.summary;
    const vi: NumFmt = { decimal: ',', thousand: '.' };

    for (const c of CARDS) {
      let found = '';
      for (const l of c.labels) {
        if (await cardOf(page, l).isVisible().catch(() => false)) {
          found = l;
          break;
        }
      }
      report.check(Boolean(found), `Có card "${c.labels.join('" / "')}"`);
      if (!found) continue;
      if (found !== c.labels[0]) report.note(`   (card ghi "${found}" — thiết kế ghi "${c.labels[0]}")`);
      const card = cardOf(page, found);

      const shown = ((await card.locator('div.mt-1').textContent()) ?? '').trim();
      const value = Number(s?.[c.key] ?? 0);
      if (c.key === 'stockValue') {
        const want = ruleCompact(value, vi);
        report.check(sameCompact(shown, want), `Card "${found}" hiện "${shown}" (rút gọn đúng rule)`, sameCompact(shown, want) ? '' : `đúng rule phải là "${want}" (số gốc ${money(value)})`);
      } else {
        report.same(`Card "${found}" hiện "${shown}"`, parseVi(shown), value, 'API');
      }

      // (i) — so với cột "Infor (i)" của sheet
      const icon = card.locator('amf-tooltip').first();
      const tip = await hoverTooltip(page, icon, '');
      if (!tip) {
        report.check(false, `Card "${found}": hover (i) hiện giải thích`, 'không hiện');
      } else if (loose(tip) === loose(c.hint)) {
        report.check(true, `Card "${found}": (i) = "${tip}"`);
      } else {
        const lack = c.keys.filter((k) => !norm(tip).includes(norm(k)));
        if (lack.length) report.check(false, `Card "${found}": (i) sai so với thiết kế`, `hiện "${tip}" — thiết kế "${c.hint}"`);
        else report.warn(`Card "${found}": (i) khác chữ so với thiết kế`, `hiện "${tip}" — thiết kế "${c.hint}"`);
      }
      await page.mouse.move(0, 0);
    }
    await report.shot('Card tổng', page.locator('.dash-card').first().locator('..'));
    report.note('');

    // đối chiếu với bảng (mọi cửa hàng, số liệu hiện tại) và biểu đồ
    const since = api.mark();
    await page.reload();
    const { items } = await readTable(page, api, report, { since, shots: false });
    const tableQty = sum(items, (r) => r.stockQuantity);
    const tableValue = sum(items, (r) => r.stockValue);
    report.note(`Bảng Tồn Kho Theo Cửa Hàng: ${items.length} cửa hàng, ${qtyText(tableQty)} sản phẩm tồn, giá trị theo giá bán ${money(tableValue)}`);
    report.same('Card "Số lượng tồn kho" = cộng số lượng tồn các cửa hàng (bảng)', Number(s.stockQuantity), tableQty, 'bảng');
    // card tính theo giá vốn (đúng (i)); cột "Gtrị SP hiện có" của bảng tính theo giá bán → không so 2 số này
    report.check(Number(s.lowStockProducts) >= 0 && Number(s.slowMovingProducts) >= 0, 'Card sắp hết hàng / chậm tiêu thụ không âm (không có thì hiện 0)');

    // đối chiếu với trang Quản lý kho (sản phẩm có quản lý tồn, còn hàng)
    const pickStores = [...items].sort((a, b) => b.productCount - a.productCount).slice(0, 5).filter((r) => r.productCount > 0);
    if (!pickStores.length) {
      report.warn('Không cửa hàng nào có hàng tồn để đối chiếu với trang Quản lý kho');
      return;
    }
    report.note('');
    report.note(`Đối chiếu với trang Quản lý kho: ${pickStores.map((r) => r.storeName).join(', ')}`);
    const wh = await readWarehouse(page, report, pickStores.map((r) => r.storeId));
    for (const r of pickStores) {
      const rows = wh.rows.filter((x) => x.storeId === r.storeId && Number(x.quantity) > 0);
      const whQty = sum(rows, (x) => x.quantity);
      if (Number(r.productCount) === rows.length && Math.abs(Number(r.stockQuantity) - whQty) < 0.001) {
        report.check(true, `"${r.storeName}": ${rows.length} SP hiện có, ${qtyText(whQty)} tồn — khớp Quản lý kho`);
      } else {
        // Quản lý kho chỉ liệt kê sản phẩm có quản lý tồn kho; báo cáo cộng mọi dòng tồn > 0
        report.warn(`"${r.storeName}": báo cáo ${qtyText(r.productCount)} SP / ${qtyText(r.stockQuantity)} tồn ≠ Quản lý kho ${rows.length} SP / ${qtyText(whQty)} tồn`,
          'chênh có thể do sản phẩm không quản lý tồn kho (Quản lý kho không hiện) — kiểm tra lại');
      }
      const value = sum(rows, (x) => Number(x.quantity) * Number(x.price ?? 0));
      if (Math.abs(value - Number(r.stockValue)) > TOLERANCE) {
        report.warn(`"${r.storeName}": Gtrị SP hiện có ${money(r.stockValue)} ≠ Σ(SL × giá bán) ở Quản lý kho ${money(value)}`, 'giá bán ở kho có thể khác giá bán sản phẩm hiện tại');
      } else {
        report.check(true, `"${r.storeName}": Gtrị SP hiện có = Σ(SL × giá bán) ở Quản lý kho (${money(value)})`);
      }
    }
  });

  test('2. Top 10 sản phẩm bán chạy', async ({ page, api, report }) => {
    const ov = await openOverview(page, api, report);
    const card = await checkTopChart(page, report, 'Top 10 Sản Phẩm Bán Chạy', ov.top, (it) => Number(it.soldQuantity), ov.range);
    const hit = ov.top.findIndex((it) => Number(it.soldQuantity) > 0);
    if (hit < 0) return;
    const it = ov.top[hit];
    const tip = await hoverTooltip(page, card.locator('.top-bar-hit').nth(hit), 'Số lượng bán');
    if (!tip) return report.check(false, `Hover "${it.productName}" hiện tooltip`, 'không hiện');
    report.check(norm(tip).includes(norm(it.productName)), `Tooltip có tên sản phẩm "${it.productName}"`, tip);
    report.same('Tooltip — số lượng bán', tipValue(tip, 'Số lượng bán'), Number(it.soldQuantity), 'API');
    report.same('Tooltip — doanh thu', tipValue(tip, 'Doanh thu'), Number(it.revenue), 'API', 'đ');
    checkTipStock(report, tip, it);
    await report.shot('Top bán chạy — tooltip', 'viewport');
  });

  test('3. Top 10 sản phẩm chậm tiêu thụ', async ({ page, api, report }) => {
    const ov = await openOverview(page, api, report);
    const days = (it: any) => Number(it.slowMovingDays ?? 0);
    const card = await checkTopChart(page, report, 'Top 10 Sản Phẩm Chậm Tiêu Thụ', ov.slow, days, ov.range);

    // số ngày tồn = từ đơn hàng cuối cùng tới hôm nay
    const now = today();
    const wrong = ov.slow
      .filter((it) => it.lastSoldAt)
      .map((it) => ({ it, want: Math.max(0, daysBetween(String(it.lastSoldAt).slice(0, 10), now)) }))
      .filter((x) => x.want !== days(x.it));
    report.check(!wrong.length, 'Số ngày tồn = số ngày từ đơn hàng cuối cùng tới hôm nay',
      wrong.slice(0, 5).map((x) => `"${x.it.productName}": ${days(x.it)} ngày, bán lần cuối ${vnDate(String(x.it.lastSoldAt).slice(0, 10))} → ${x.want} ngày`).join('; '));
    const sold = ov.slow.filter((it) => Number(it.soldQuantity) > 0);
    if (sold.length) report.warn(`${sold.length} sản phẩm trong Top chậm tiêu thụ vẫn có bán trong khoảng ngày`, sold.map((it) => `${it.productName} (${qtyText(it.soldQuantity)})`).join(', '));

    const hit = ov.slow.findIndex((it) => days(it) > 0);
    if (hit < 0) return;
    const it = ov.slow[hit];
    const tip = await hoverTooltip(page, card.locator('.top-bar-hit').nth(hit), 'Số lượng tồn');
    if (!tip) return report.check(false, `Hover "${it.productName}" hiện tooltip`, 'không hiện');
    report.check(norm(tip).includes(norm(it.productName)), `Tooltip có tên sản phẩm "${it.productName}"`, tip);
    report.same('Tooltip — số ngày tồn', tipValue(tip, 'ngày chậm tiêu thụ|ngày tồn'), days(it), 'API');
    checkTipStock(report, tip, it);
    await report.shot('Top chậm tiêu thụ — tooltip', 'viewport');
  });

  test('4. Bảng tồn kho theo cửa hàng', async ({ page, api, report }) => {
    test.setTimeout(120_000);
    const ov = await openOverview(page, api, report);
    const fmt = await readFmt(page);
    const card = tableCard(page);
    const heads = (await card.locator('thead th').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    const wantHeads: [string, RegExp][] = [
      ['Tên cửa hàng', /cửa hàng/i], ['Sản phẩm hiện có', /^SP Hiện Có|Sản phẩm hiện có/i], ['Giá trị sản phẩm hiện có', /G(iá )?trị SP Hiện Có|Giá trị sản phẩm hiện có/i],
      ['Sản phẩm tồn quá hạn', /^SP Tồn Quá Hạn|Sản phẩm tồn quá hạn/i], ['Giá trị tồn quá hạn', /G(iá )?trị Tồn Quá Hạn/i], ['Xem chi tiết', /Thao Tác|Xem chi tiết/i],
    ];
    const lack = wantHeads.filter(([, re]) => !heads.some((h) => re.test(h)));
    report.check(!lack.length, `Bảng có đủ cột (${heads.join(' | ')})`, lack.map(([n]) => `thiếu "${n}"`).join(', '));

    const { items, rows, total } = await readTable(page, api, report, { since: ov.since });
    report.same('Số dòng trên bảng', rows.length, total, 'tổng số dòng');
    const wrong: string[] = [];
    items.forEach((it, i) => {
      const r = rows[i];
      if (!r) return;
      const cmp = (what: string, text: string, v: number) => {
        if (Math.abs(parseWith(text, fmt) - Number(v ?? 0)) > TOLERANCE) wrong.push(`${it.storeName} / ${what}: hiện "${text}", API ${qtyText(v)}`);
      };
      if (norm(r.name) !== norm(it.storeName)) wrong.push(`dòng ${i + 1}: tên "${r.name}" ≠ "${it.storeName}"`);
      cmp('SP hiện có', r.productCount, it.productCount);
      cmp('Gtrị SP hiện có', r.stockValue, it.stockValue);
      cmp('SP tồn quá hạn', r.slowCount, it.slowMovingProductCount);
      cmp('Gtrị tồn quá hạn', r.slowValue, it.slowMovingStockValue);
    });
    report.check(!wrong.length, `Số trên bảng khớp dữ liệu (${items.length} cửa hàng)`, wrong.slice(0, 8).join('; '));

    // SP hiện có tính cả sản phẩm không quản lý tồn (tồn ∞) → có sản phẩm mà số lượng tồn = 0 vẫn đúng
    const odd = items.filter((it) =>
      Number(it.slowMovingProductCount) > Number(it.productCount) ||
      Number(it.slowMovingStockValue) > Number(it.stockValue) + TOLERANCE ||
      (Number(it.stockQuantity) > 0 && Number(it.productCount) === 0));
    report.check(!odd.length, 'Tồn quá hạn ≤ hiện có; có số lượng tồn ⇒ có sản phẩm', odd.map((it) => it.storeName).join(', '));
    const decimals = rows.find((r) => /[.,]\d+$/.test(r.productCount.replace(/\s/g, '')) && parseWith(r.productCount, fmt) % 1 === 0);
    if (decimals) report.warn('Cột SP Hiện Có / SP Tồn Quá Hạn là số sản phẩm nhưng hiện phần thập phân', `vd "${decimals.productCount}"`);
    const unsorted = items.findIndex((it, i) => i > 0 && Number(items[i - 1].stockValue) < Number(it.stockValue));
    if (unsorted > 0) report.warn('Bảng không sắp theo giá trị tồn giảm dần', `"${items[unsorted].storeName}" đứng sau "${items[unsorted - 1].storeName}"`);

    // có sản phẩm mà tồn 0 → vào chi tiết: đếm sản phẩm, cộng tồn (bỏ sản phẩm tồn ∞)
    const noStock = items.filter((it) => Number(it.productCount) > 0 && Number(it.stockQuantity) === 0).slice(0, 3);
    for (const st of noStock) {
      report.note('');
      report.note(`"${st.storeName}": ${qtyText(st.productCount)} SP hiện có nhưng tồn 0 → vào chi tiết kiểm tra`);
      await page.goto(`/reports/inventory/product?storeId=${st.storeId}`);
      const d = await readDetail(page, fmt);
      if (!d) {
        report.warn(`"${st.storeName}": không đọc được bảng chi tiết`);
        continue;
      }
      report.note(`   ${d.cells.map((c) => `${c[0]}: ${c[d.iStock] ?? '?'}`).join('; ')}`);
      if (d.paged) report.note('   bảng chi tiết nhiều trang — chỉ so trang đầu');
      else report.same(`"${st.storeName}" — số dòng chi tiết = SP hiện có`, d.cells.length, Number(st.productCount), 'bảng cửa hàng');
      report.same(`"${st.storeName}" — cộng tồn (bỏ ∞) = số lượng tồn`, d.stockSum, Number(st.stockQuantity), 'bảng cửa hàng');
      await report.shot(`Chi tiết "${st.storeName}"`);
    }
  });

  test('5. Bảng — bộ lọc cửa hàng, trạng thái, Đặt Lại', async ({ page, api, report }) => {
    test.setTimeout(150_000);
    const ov = await openOverview(page, api, report);
    const card = tableCard(page);
    const { items: all } = await readTable(page, api, report, { since: ov.since, shots: false });

    // cửa hàng
    const pick = uniqueNames(all).slice(0, 2);
    if (pick.length) {
      report.note(`Lọc ${pick.length} cửa hàng: ${pick.map((p) => p.storeName).join(', ')}`);
      const since = api.mark();
      await toggleOptions(storeSelect(card), pick.map((p) => p.storeName));
      const { items } = await readTable(page, api, report, { since, params: { storeIds: pick.map((p) => String(p.storeId)) }, title: 'Lọc cửa hàng' });
      report.check(items.length === pick.length && items.every((it) => pick.some((p) => p.storeId === it.storeId)), `Chỉ còn ${pick.length} cửa hàng đã chọn`, items.map((it) => it.storeName).join(', '));
      for (const p of pick) {
        const got = items.find((it) => it.storeId === p.storeId);
        report.same(`"${p.storeName}" — Gtrị SP hiện có sau khi lọc`, Number(got?.stockValue ?? NaN), Number(p.stockValue), 'lúc chưa lọc', 'đ');
      }
      const reset = api.mark();
      await card.getByRole('button', { name: 'Đặt Lại', exact: true }).click();
      const back = await api.wait(TABLE, { since: reset, pred: hasNone(['storeIds', 'storeStatusIds']) });
      report.same('Bấm "Đặt Lại" → tổng số cửa hàng', Number(back?.total ?? 0), all.length, 'lúc chưa lọc');
      await expect.soft(card.getByRole('button', { name: 'Đặt Lại', exact: true }), 'Không còn lọc mà nút "Đặt Lại" vẫn bấm được').toBeDisabled();
      await report.shot('Đặt Lại bộ lọc', card);
    } else {
      report.warn('Không có cửa hàng tên không trùng để thử lọc');
    }

    // trạng thái cửa hàng
    for (const [status, id] of [['Đang hoạt động', 1], ['Dừng hoạt động', 0]] as const) {
      report.note('');
      report.note(`Lọc trạng thái "${status}"`);
      const since = api.mark();
      await toggleOptions(statusSelect(card), [status]);
      const { items } = await readTable(page, api, report, { since, params: { storeStatusIds: [String(id)] }, title: `Lọc "${status}"` });
      const expected = all.filter((it) => Number(it.storeStatusId) === id);
      const bad = items.filter((it) => Number(it.storeStatusId) !== id);
      report.check(!bad.length, `Mọi dòng đều "${status}"`, bad.map((it) => `${it.storeName} (${it.storeStatusName})`).join(', '));
      report.same(`Số cửa hàng "${status}"`, items.length, expected.length, 'đếm trong bảng chưa lọc');
      if (!items.length) await expect.soft(card.locator('app-table-empty'), `Lọc "${status}" không còn dòng mà không hiện bảng trống`).toBeVisible();
      await toggleOptions(statusSelect(card), [status]);
      await api.wait(TABLE, { since, pred: hasNone(['storeStatusIds']) });
    }
  });

  test('6. Xem chi tiết → Tồn kho theo sản phẩm', async ({ page, api, report }) => {
    const ov = await openOverview(page, api, report);
    const card = tableCard(page);
    const body = await api.wait(TABLE, { since: ov.since });
    const items: any[] = body?.items ?? [];
    const idx = items.reduce((best, it, i) => (Number(it.productCount) > Number(items[best]?.productCount ?? -1) ? i : best), 0);
    const store = items[idx];
    if (!store) {
      report.warn('Bảng không có cửa hàng nào');
      return;
    }
    report.note(`Cửa hàng: "${store.storeName}" — ${qtyText(store.productCount)} sản phẩm, ${qtyText(store.stockQuantity)} tồn`);
    const row = card.locator('tbody tr').nth(idx);
    const action = row.locator('td').last().locator('button').first();
    await settle(action);
    await action.click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await report.shot('Sau khi bấm Xem chi tiết');
    const url = page.url();
    report.note(`Trang mở ra: ${url}`);
    if (/\/errors\/|404/.test(url) || (await page.getByText('Trang không tồn tại').isVisible().catch(() => false))) {
      report.warn('Xem chi tiết → trang "Tồn kho theo sản phẩm" chưa có trên môi trường này', `ra ${new URL(url).pathname} — chưa kiểm tra được bảng chi tiết và nút Xuất file`);
      return;
    }
    report.check(/\/reports\/inventory\/product/.test(url) && url.includes(`storeId=${store.storeId}`), 'Đường dẫn trang chi tiết có đúng cửa hàng', url);
    await expect.soft(page.getByText(/Tồn kho theo sản phẩm/i).first(), 'Không thấy tiêu đề "Tồn kho theo sản phẩm"').toBeVisible();

    const fmt = await readFmt(page);
    const d = await readDetail(page, fmt);
    const heads = d?.heads ?? [];
    const want = ['Tên sản phẩm|Sản phẩm', 'Danh mục', 'Tồn kho', 'Thời gian tồn', 'Đã bán', 'Xuất kho', POS_COL];
    const lack = want.filter((w) => !heads.some((h) => new RegExp(w, 'i').test(h)));
    report.check(!lack.length, `Bảng chi tiết đủ cột (${heads.join(' | ')})`, lack.map((l) => `thiếu "${l}"`).join(', '));
    const col = (re: RegExp) => heads.findIndex((h) => re.test(h));
    const iSold = col(/^Đã bán$/i);
    const iWh = col(/Xuất kho/i);
    const iPos = col(new RegExp(POS_COL, 'i'));
    const cells = d?.cells ?? [];
    report.note(`   ${cells.length} dòng trên trang đầu${d?.infinite ? `, ${d.infinite} sản phẩm tồn ∞ (không quản lý tồn)` : ''}`);
    if (d && d.iStock >= 0 && cells.length) {
      if (d.paged) report.note('   bảng chi tiết nhiều trang — chỉ so trang đầu');
      else {
        report.same('Số dòng = SP hiện có của cửa hàng', cells.length, Number(store.productCount), 'bảng cửa hàng');
        report.same('Cộng cột Tồn kho (bỏ ∞) = số lượng tồn của cửa hàng', d.stockSum, Number(store.stockQuantity), 'bảng cửa hàng');
      }
    }
    if (iSold >= 0 && iWh >= 0 && iPos >= 0) {
      const bad = cells.filter((c) => Math.abs(parseWith(c[iSold], fmt) - parseWith(c[iWh], fmt) - parseWith(c[iPos], fmt)) > 0.001);
      report.check(!bad.length, 'Đã bán = Đã bán tại Xuất kho + Đã bán tại Bán hàng tại quầy', bad.slice(0, 5).map((c) => c[0]).join(', '));
    }
    // xuất file: có dòng → tải được file .xlsx; không có dòng → nút bị khoá
    const exportBtn = page.getByRole('button', { name: /Xuất/i }).first();
    const hasExport = await exportBtn.isVisible().catch(() => false);
    report.check(hasExport, 'Trang chi tiết có nút "Xuất file"');
    if (hasExport && !cells.length) {
      report.check(await exportBtn.isDisabled(), 'Không có dòng → nút "Xuất file" bị khoá');
    } else if (hasExport) {
      const download = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
      await exportBtn.click();
      const file = await download;
      const path = file ? await file.path().catch(() => null) : null;
      const size = path ? (await import('fs')).statSync(path).size : 0;
      report.check(Boolean(file) && /.xlsx$/i.test(file!.suggestedFilename()) && size > 0, 'Bấm "Xuất file" → tải file .xlsx', file ? `${file.suggestedFilename()} (${size} byte)` : 'không tải được file');
      await report.shot('Xuất file trang chi tiết');
    }
  });

  test('7. Bộ lọc thời gian', async ({ page, api, report }) => {
    test.setTimeout(150_000);
    const ov = await openOverview(page, api, report, { defaultRange: true });
    const def = ov.range;
    report.check(def.from === monthAgo() && def.to === today(), `Mặc định 1 tháng tới hôm nay (${vnDate(monthAgo())} → ${vnDate(today())})`, `trang dùng ${vnDate(def.from)} → ${vnDate(def.to)}`);
    const before = ov.summary;
    const tableBefore = await api.wait(TABLE, { since: ov.since });

    // chọn nhanh: đủ theo yêu cầu + bấm từng nút ra đúng khoảng ngày
    const picker = page.locator('amf-daterange').first();
    const openPicker = async () => {
      await page.locator('amf-daterange input').first().click();
      await page.waitForTimeout(400);
    };
    await openPicker();
    await report.shot('Bộ chọn ngày', 'viewport');
    const shown = (await picker.locator('button:visible').allInnerTexts()).map((t) => t.trim()).filter((t) => /\p{L}{2,}/u.test(t));
    report.note(`Nút chọn nhanh trên trang: ${shown.join(', ') || '(không có)'}`);
    const missing = PRESETS.filter((p) => !shown.some((s) => norm(s) === norm(p)));
    report.check(!missing.length, `Có chọn nhanh: ${PRESETS.join(', ')}`, missing.length ? `thiếu ${missing.join(', ')}` : '');
    for (const name of shown) {
      const want = presetRange(name);
      if (!want) {
        report.warn(`Nút chọn nhanh "${name}" không có trong yêu cầu — không biết khoảng ngày đúng để so`);
        continue;
      }
      if (!(await picker.getByRole('button', { name, exact: true }).isVisible().catch(() => false))) await openPicker();
      const s = api.mark();
      await picker.getByRole('button', { name, exact: true }).click();
      const ok = await api.wait(SUMMARY, { since: s, range: want, timeout: 8_000 }).then(() => true).catch(() => false);
      const got = api.calls(SUMMARY, { since: s }).at(-1)?.url.searchParams;
      report.check(ok, `Chọn nhanh "${name}" → ${vnDate(want.from)} → ${vnDate(want.to)}`, ok ? '' : got ? `trang dùng ${vnDate(got.get('startDate') ?? '')} → ${vnDate(got.get('endDate') ?? '')}` : 'không tải lại số liệu');
      await page.keyboard.press('Escape');
    }
    const sr = api.mark();
    await page.reload();
    await api.wait(SUMMARY, { since: sr, range: def });
    await openPicker();

    // không cho chọn tương lai
    const tomorrow = addDays(today(), 1);
    const sinceFuture = api.mark();
    const input = page.locator('amf-daterange input').nth(1);
    await input.focus();
    await input.press('ArrowLeft');
    await input.press('ArrowLeft');
    await input.pressSequentially(vnDate(tomorrow).replace(/\//g, ''));
    await page.waitForTimeout(2_500);
    const future = api.calls(SUMMARY, { since: sinceFuture, pred: (u) => (u.searchParams.get('endDate') ?? '') > today() });
    report.check(!future.length, `Gõ ngày tương lai ${vnDate(tomorrow)} vào "Đến ngày" → không được nhận`, future.length ? `trang gọi API tới ${future[0].url.searchParams.get('endDate')}` : '');
    await report.shot('Gõ ngày tương lai', 'viewport');
    await page.keyboard.press('Escape');

    // đổi khoảng ngày (7 ngày gần nhất) → card / biểu đồ / top dùng khoảng mới; tồn kho hiện tại không đổi
    const week: Range = { from: addDays(today(), -6), to: today() };
    report.note('');
    report.note(`Đổi sang ${vnDate(week.from)} → ${vnDate(week.to)}`);
    await page.reload();
    const s2 = api.mark();
    const cur = await api.firstRange(SUMMARY, s2);
    await setRange(page, week, cur);
    const [summary, , , table] = await Promise.all([
      api.wait(SUMMARY, { range: week, since: s2 }),
      api.wait(TOP, { range: week, since: s2 }),
      api.wait(SLOW, { range: week, since: s2 }),
      api.wait(TABLE, { range: week, since: s2 }),
    ]);
    report.check(true, 'Card, Top 10 và bảng đều tải lại theo khoảng ngày mới');
    const header = (await topHeader(topCard(page, 'Top 10 Sản Phẩm Bán Chạy'), 'Top 10 Sản Phẩm Bán Chạy').innerText()).replace(/\s+/g, ' ');
    report.check(header.includes(`(Từ ${dotDate(week.from)} - ${dotDate(week.to)})`), 'Tiêu đề Top 10 đổi theo khoảng ngày mới', header);
    const d = summary?.data ?? {};
    report.same('Giá trị tồn kho không đổi theo khoảng ngày (số liệu hiện tại)', Number(d.stockValue), Number(before.stockValue), `lúc ${vnDate(def.from)} → ${vnDate(def.to)}`, 'đ');
    report.same('Số lượng tồn kho không đổi theo khoảng ngày', Number(d.stockQuantity), Number(before.stockQuantity), 'lúc khoảng mặc định');
    report.same('Số lượng sắp hết hàng không đổi theo khoảng ngày', Number(d.lowStockProducts), Number(before.lowStockProducts), 'lúc khoảng mặc định');
    report.same(`Hàng chậm tiêu thụ (> ${SLOW_DAYS} ngày) không đổi theo khoảng ngày`, Number(d.slowMovingProducts), Number(before.slowMovingProducts), 'lúc khoảng mặc định');
    const tA = (tableBefore?.items ?? []).map((x: any) => `${x.storeId}:${x.stockValue}:${x.slowMovingProductCount}`).join('|');
    const tB = (table?.items ?? []).map((x: any) => `${x.storeId}:${x.stockValue}:${x.slowMovingProductCount}`).join('|');
    report.check(tA === tB, 'Bảng tồn kho theo cửa hàng không đổi theo khoảng ngày (số liệu tại thời điểm hiện tại)');
    await report.shot(`Khoảng ${vnDate(week.from)} → ${vnDate(week.to)}`);

    // xoá → về mặc định
    const s3 = api.mark();
    const clear = page.locator('amf-daterange button').first();
    await page.locator('amf-daterange').first().hover();
    await clear.click();
    const back = await api.wait(SUMMARY, { since: s3, range: { from: monthAgo(), to: today() } }).catch(() => null);
    report.check(Boolean(back), 'Xoá khoảng ngày → về mặc định 1 tháng gần nhất');
  });

  test('8. Tạo đơn → cập nhật realtime → huỷ đơn', async ({ page, api, report }) => {
    test.skip(!CREATE_ORDER, 'Đã tắt tạo đơn (INVENTORY_CREATE_ORDER=0)');
    test.setTimeout(420_000);

    const pos = await page.context().newPage();
    await autoDismissSecurityPopup(pos);
    // cửa hàng đang bán = storeId trong lời gọi tìm sản phẩm của màn hình bán tại quầy
    let posStoreId = 0;
    pos.on('request', (r) => {
      if (!r.url().includes('/products/search-product')) return;
      const b = r.postDataJSON?.() ?? {};
      const id = Number(b?.searchParams?.storeId ?? b?.storeId ?? 0);
      if (id) posStoreId = id;
    });
    try {
      report.page = pos;
      const shop = await openPos(pos);
      const pickable = (p: PosProduct) => p.isDependOnStock && Number(p.inStock) >= 1 && Number(p.price) > 0;
      const product = ORDER_PRODUCT
        ? await findOnPos(pos, ORDER_PRODUCT, shop.products, ORDER_PRODUCT_ID)
        : shop.products.filter(pickable).sort((a, b) => Number(a.price) - Number(b.price))[0];
      expect(product, 'Không có sản phẩm nào có quản lý tồn kho + còn hàng để tạo đơn').toBeTruthy();
      expect(pickable(product!), `"${product!.productName}" không quản lý tồn kho hoặc hết hàng — chọn sản phẩm khác`).toBe(true);
      report.page = page;

      // trang Tồn Kho mở sẵn, lọc bảng theo cửa hàng bán
      const ov = await openOverview(page, api, report, { defaultRange: true, quiet: true });
      const { items: stores } = await readTable(page, api, report, { since: ov.since, shots: false });
      const found = stores.find((x: any) => (posStoreId ? x.storeId === posStoreId : norm(x.storeName) === norm(shop.storeName)));
      expect(found, `Trang Tồn Kho không có cửa hàng đang bán tại quầy (${shop.storeName || `id ${posStoreId}`})`).toBeTruthy();
      const storeId = Number(found.storeId);
      const storeName: string = found.storeName;
      report.note(`Cửa hàng: ${storeName}`);
      report.note(`Sản phẩm bán: "${product!.productName}" — giá ${money(Number(product!.price))}, còn ${qtyText(Number(product!.inStock))}`);
      const s0 = api.mark();
      await toggleOptions(storeSelect(tableCard(page)), [storeName]);
      const store = ((await api.wait(TABLE, { since: s0, params: { storeIds: [String(storeId)] } }))?.items ?? [])[0];
      expect(store, `Lọc bảng theo "${storeName}" không ra dòng nào`).toBeTruthy();
      const snap = (sum0: any, table: any[], top: any[]) => {
        const row = table.find((x: any) => x.storeId === storeId);
        const tp = top.find((x: any) => x.productId === product!.productId);
        return {
          stockQuantity: Number(sum0?.stockQuantity ?? 0), stockValue: Number(sum0?.stockValue ?? 0),
          rowQty: Number(row?.stockQuantity ?? 0), rowValue: Number(row?.stockValue ?? 0), rowCount: Number(row?.productCount ?? 0),
          topSold: tp ? Number(tp.soldQuantity) : null,
        };
      };
      const before = snap(ov.summary, [store], ov.top);
      report.note(`Trước: tồn ${qtyText(before.stockQuantity)} (${money(before.stockValue)}); "${storeName}": tồn ${qtyText(before.rowQty)}, Gtrị ${money(before.rowValue)}`);
      await report.shot('Trước khi tạo đơn');

      /** Chờ trang tự tải lại (SSE) — không bấm F5; không thấy thì tải lại trang để vẫn so được số */
      const waitRealtime = async (since: number, changed: (s: any) => boolean, label: string) => {
        const live = await expect
          .poll(async () => {
            for (const c of api.calls(SUMMARY, { since }).reverse()) if (changed((await c.json)?.data)) return true;
            return false;
          }, { timeout: 45_000 })
          .toBe(true)
          .then(() => true)
          .catch(() => false);
        report.check(live, `${label}: trang Tồn Kho tự cập nhật (realtime, không tải lại trang)`);
        let s = since;
        if (!live) {
          s = api.mark();
          await page.reload();
          await expect(tableCard(page).locator('tbody tr').first()).toBeVisible();
          await toggleOptions(storeSelect(tableCard(page)), [storeName]);
        }
        await page.waitForTimeout(2_000);
        const sum1 = (await api.wait(SUMMARY, { since: s }))?.data;
        const top = (await api.wait(TOP, { since: s }))?.data?.items ?? [];
        const table = (await api.wait(TABLE, { since: s, params: { storeIds: [String(storeId)] } }))?.items ?? [];
        await report.shot(label);
        return snap(sum1, table, top);
      };

      // tạo đơn ở tab khác
      report.page = pos;
      const mark = api.mark();
      await openPos(pos);
      const order = await sell(pos, [{ product: product!, qty: 1 }], (name, target) => report.shot(name, target));
      report.page = page;
      const qty = 1;
      const price = Number(product!.price);
      report.note(`✔ Đã tạo đơn ${order.orderCode} — 1 × "${product!.productName}", doanh thu ${money(order.revenue)}`);
      report.note('');

      const after = await waitRealtime(mark, (s) => Number(s?.stockQuantity) !== before.stockQuantity, 'Sau khi tạo đơn');
      report.same('Card "Số lượng tồn kho" giảm', before.stockQuantity - after.stockQuantity, qty, 'số lượng bán');
      report.check(after.stockValue < before.stockValue, `Card "Giá trị tồn kho" giảm (${money(before.stockValue)} → ${money(after.stockValue)})`);
      report.same(`Bảng "${storeName}" — số lượng tồn giảm`, before.rowQty - after.rowQty, qty, 'số lượng bán');
      report.same(`Bảng "${storeName}" — Gtrị SP hiện có giảm`, before.rowValue - after.rowValue, qty * price, 'SL × giá bán', 'đ');
      if (Number(product!.inStock) === qty) report.same(`Bảng "${storeName}" — SP hiện có giảm (bán hết)`, before.rowCount - after.rowCount, 1, '1 sản phẩm');
      if (after.topSold !== null) report.same(`Top bán chạy "${product!.productName}" — số lượng bán tăng`, after.topSold - (before.topSold ?? 0), qty, 'số lượng bán');
      else report.note(`   "${product!.productName}" chưa vào Top 10 bán chạy`);

      if (!CANCEL_ORDER) {
        report.warn(`Không huỷ đơn ${order.orderCode} (đã tắt INVENTORY_CANCEL_ORDER)`);
        return;
      }
      report.note('');
      report.page = pos;
      const mark2 = api.mark();
      await cancelTestOrder(pos, report, order);
      report.page = page;
      const back = await waitRealtime(mark2, (s) => Number(s?.stockQuantity) !== after.stockQuantity, 'Sau khi huỷ đơn');
      report.same('Huỷ đơn → card "Số lượng tồn kho" cộng lại', back.stockQuantity - after.stockQuantity, qty, 'số lượng đơn huỷ');
      report.same('Huỷ đơn → card "Giá trị tồn kho" cộng lại đúng phần đã giảm', back.stockValue - after.stockValue, before.stockValue - after.stockValue, 'phần giảm lúc bán', 'đ');
      report.same(`Huỷ đơn → bảng "${storeName}" số lượng tồn cộng lại`, back.rowQty - after.rowQty, qty, 'số lượng đơn huỷ');
      report.same(`Huỷ đơn → bảng "${storeName}" Gtrị SP hiện có cộng lại`, back.rowValue - after.rowValue, qty * price, 'SL × giá bán', 'đ');
    } finally {
      report.page = page;
      if (pos !== page) await pos.close().catch(() => {});
    }
  });
});
