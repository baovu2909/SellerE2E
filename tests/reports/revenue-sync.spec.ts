import { Locator, Page, Response, TestInfo } from '@playwright/test';
import { expect, test as base } from '../shared-page';
import { findOnPos, openPos, pickProduct, sell } from '../pos';

/**
 * Kiểm tra số liệu trên trang Báo cáo doanh thu (/reports/revenue), thao tác trên giao diện như người dùng,
 * mỗi phần 1 test kèm ảnh chụp từng bước:
 *   1–3.   Tổng quan, PTTT (biểu đồ tròn + Xem chi tiết)
 *   4–11.  Tab Cửa Hàng / Nhân Viên / Kênh Bán / Sản Phẩm — biểu đồ + trang "Xem Chi Tiết"
 *   12–15. Bộ lọc trong từng tab (và lọc Danh Mục ở trang chi tiết Sản Phẩm)
 *   16.    Tạo 1 đơn bán tại quầy → doanh thu tăng đúng Σ(SL × giá − KM dòng), không tính VAT (tắt: REVENUE_CREATE_ORDER=0)
 * Số tiền rút gọn (ô tổng, trục, số trên cột) được so với rule làm tròn — xem ruleCompact().
 *
 * Khoảng ngày: mặc định của trang (1 tháng gần nhất). Đổi bằng REVENUE_FROM / REVENUE_TO (YYYY-MM-DD).
 */

const TOLERANCE = 1; // đồng
const ENV_FROM = process.env.REVENUE_FROM || '';
const ENV_TO = process.env.REVENUE_TO || '';
const CREATE_ORDER = process.env.REVENUE_CREATE_ORDER !== '0';
const ORDER_PRODUCT = (process.env.REVENUE_ORDER_PRODUCT || '').trim();
const ORDER_PRODUCT_ID = Number(process.env.REVENUE_ORDER_PRODUCT_ID) || undefined;

const SUMMARY = 'reports/revenue/overview/summary';
const CHART = 'reports/revenue/overview/chart';
const PAYMENT = 'reports/revenue/overview/payment-methods';
const PRODUCT_CHART = 'reports/revenue/product/chart';
const PRODUCT_REPORT = 'reports/revenue/product/report';
const PRODUCT_TITLE = 'Doanh Thu Theo Sản Phẩm';

const TICK_RATIOS = [1, 0.8, 0.6, 0.4, 0.2, 0];
const PRODUCT_TOP = 10;
const CATEGORY_PARAMS = ['categoryLevel1Id', 'categoryLevel2Id', 'categoryLevel3Id'];

interface Range { from: string; to: string }
interface NumFmt { decimal: string; thousand: string }

interface ChartTab {
  label: string;
  comp: string;
  /** tiền tố class của cột: .store-bar, .store-bar-value … */
  cls: string;
  chart: string;
  /** số cột tối đa trên 1 màn hình, nhiều hơn thì cuộn ngang */
  maxVisible: number;
  detail: { report: string; title: string };
  id: (it: any) => string;
  name?: (it: any) => string;
  filterParam: string;
  noun: string;
}

const TABS: ChartTab[] = [
  {
    label: 'Cửa Hàng', comp: 'app-revenue-store-tab', cls: 'store', chart: 'reports/revenue/store/chart', maxVisible: 15,
    detail: { report: 'reports/revenue/store/report', title: 'Doanh Thu Theo Cửa Hàng' },
    id: (it) => String(it.storeId), name: (it) => it.storeName, filterParam: 'storeIds', noun: 'cửa hàng',
  },
  {
    label: 'Nhân Viên', comp: 'app-revenue-employee-tab', cls: 'employee', chart: 'reports/revenue/employee/chart', maxVisible: 15,
    detail: { report: 'reports/revenue/employee/report', title: 'Doanh Thu Theo Nhân Viên' },
    id: (it) => String(it.refCode), name: (it) => it.employeeName, filterParam: 'employeeRefCodes', noun: 'nhân viên',
  },
  {
    // tên kênh FE tự đặt theo channelId → đọc từ nhãn dưới cột
    label: 'Kênh Bán', comp: 'app-revenue-channel-tab', cls: 'channel', chart: 'reports/revenue/channel/chart', maxVisible: 15,
    detail: { report: 'reports/revenue/channel/report', title: 'Doanh Thu Theo Kênh Bán' },
    id: (it) => String(it.channelId), filterParam: 'channelIds', noun: 'kênh bán',
  },
];

const PRODUCT_TAB = { label: 'Sản Phẩm', comp: 'app-revenue-product-tab', cls: 'store', maxVisible: PRODUCT_TOP, name: (it: any) => it.productName };

// ---------- tiện ích ----------

const money = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const sum = (rows: any[] | undefined, key: string) => (rows ?? []).reduce((s, r) => s + Number(r?.[key] ?? 0), 0);
const vnDate = (iso: string) => iso.split('-').reverse().join('/');
const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Đọc số tiền trên màn hình: "1.234.567đ", "1,234,567.00", "1.234,5 ₫" … */
function parseMoney(text: string): number {
  let s = text.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec = '';
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
  else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : '';
    // 1 dấu duy nhất và không đúng 3 số phía sau → là dấu thập phân
    if (sep && s.split(sep).length === 2 && s.length - s.lastIndexOf(sep) - 1 !== 3) dec = sep;
  }
  const thousand = dec === '.' ? ',' : '.';
  s = s.split(thousand).join('');
  if (dec === ',') s = s.replace(',', '.');
  if (!dec) s = s.replace(/[.,]/g, '');
  return Number(s) || 0;
}

/**
 * Rule số tiền rút gọn:
 *   <1.000 → đ | <1.000.000 → k | <1.000.000.000 → tr | còn lại → T
 *   1 chữ số thập phân, chữ số thứ 2 từ 5–9 làm tròn lên, 0–4 giữ nguyên; thập phân = 0 thì ẩn
 *   dấu thập phân / phân cách nghìn theo cài đặt hệ thống
 */
function ruleCompact(v: number, f: NumFmt): string {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs < 1_000) return `${sign}${Math.round(abs)}đ`;
  const [div, unit] = abs >= 1e9 ? [1e9, 'T'] : abs >= 1e6 ? [1e6, 'tr'] : [1e3, 'k'];
  // chỉ nhìn chữ số thập phân thứ 2 (làm tròn số nguyên để tránh sai số float)
  const hundredths = Math.floor(Math.round((abs * 100 * 1e6) / div) / 1e6);
  const tenths = Math.floor(hundredths / 10) + (hundredths % 10 >= 5 ? 1 : 0);
  const int = String(Math.floor(tenths / 10)).replace(/\B(?=(\d{3})+(?!\d))/g, f.thousand);
  const dec = tenths % 10;
  return `${sign}${int}${dec ? f.decimal + dec : ''}${unit}`;
}

/** Đơn vị viết hoa / thường đều được (K = k, Tr = tr); dưới 1.000 vẫn bắt buộc có "đ" */
const sameCompact = (actual: string, expected: string) => {
  const n = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return n(actual) === n(expected);
};

/** Kiểm tra hình dạng nhãn khi không biết số gốc (vd trục biểu đồ theo thời gian) */
function compactShapeError(text: string, f: NumFmt): string | null {
  const t = text.replace(/\s+/g, '');
  if (!t) return null;
  const m = t.match(new RegExp(`^-?(\\d{1,3}(?:${escapeRe(f.thousand)}\\d{3})*)(?:${escapeRe(f.decimal)}(\\d+))?(đ|k|tr|Tr|T)$`));
  if (!m) return `sai định dạng (dấu thập phân của hệ thống là "${f.decimal}", đơn vị đ / k / tr / T)`;
  const [, intPart, dec, unit] = m;
  const int = Number(intPart.split(f.thousand).join(''));
  if (dec && dec.length > 1) return 'chỉ được 1 chữ số thập phân';
  if (dec === '0') return 'phần thập phân bằng 0 phải ẩn';
  if (unit === 'đ' && dec) return 'dưới 1.000 (đ) không có phần thập phân';
  if (unit !== 'T' && int >= 1000) return `≥ 1000${unit} phải đổi sang đơn vị lớn hơn`;
  if (unit !== 'đ' && int === 0) return `dưới 1${unit} phải dùng đơn vị nhỏ hơn`;
  return null;
}

/** Giống FE: trần trục Y của biểu đồ cột */
function resolveMax(max: number, items: any[]): number {
  const highest = Math.max(0, ...items.map((x) => Number(x.revenue ?? 0)));
  if (max >= highest && max > 0) return max;
  if (highest <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(highest)));
  return Math.ceil(highest / magnitude) * magnitude;
}

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

interface WaitOpt {
  range?: Range;
  /** mảng = tham số lặp (storeIds=1&storeIds=2), so không theo thứ tự */
  params?: Record<string, string | string[]>;
  pred?: (u: URL) => boolean;
  /** chỉ nhận lời gọi sau mốc api.mark() */
  since?: number;
}

const hasAny = (keys: string[]) => (u: URL) => keys.some((k) => u.searchParams.has(k));
const hasNone = (keys: string[]) => (u: URL) => !keys.some((k) => u.searchParams.has(k));

class ApiLog {
  private items: { url: URL; status: number; json: Promise<any> }[] = [];
  private onResponse = (r: Response) => {
    if (r.request().method() !== 'GET' || !r.url().includes('/reports/revenue/')) return;
    this.items.push({ url: new URL(r.url()), status: r.status(), json: r.json().catch(() => null) });
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

  async firstRange(path: string, since = 0): Promise<Range> {
    const find = () => this.items.slice(since).find((c) => c.url.pathname.endsWith('/' + path));
    await expect.poll(() => Boolean(find()), { message: `Trang không gọi API ${path}`, timeout: 20_000 }).toBe(true);
    const { searchParams } = find()!.url;
    return { from: searchParams.get('startDate')!, to: searchParams.get('endDate')! };
  }

  /** Chờ trang gọi `path` khớp điều kiện rồi trả body JSON */
  async wait(path: string, opt: WaitOpt = {}): Promise<any> {
    const { range, params = {}, pred, since = 0 } = opt;
    const ok = (u: URL) =>
      u.pathname.endsWith('/' + path) &&
      (!range || (u.searchParams.get('startDate') === range.from && u.searchParams.get('endDate') === range.to)) &&
      Object.entries(params).every(([k, v]) =>
        Array.isArray(v)
          ? JSON.stringify(u.searchParams.getAll(k).sort()) === JSON.stringify([...v].sort())
          : (u.searchParams.get(k) ?? (k === 'page' ? '1' : null)) === v,
      ) &&
      (!pred || pred(u));
    const match = () => this.items.slice(since).findLast((c) => ok(c.url));
    await expect
      .poll(() => Boolean(match()), { message: `Trang không gọi API ${path}${range ? ` (${range.from} → ${range.to})` : ''}`, timeout: 20_000 })
      .toBe(true);
    const hit = match()!;
    expect(hit.status, `API ${path} trả lỗi ${hit.status}`).toBe(200);
    return hit.json;
  }
}

class Report {
  private lines: string[] = [];
  private shotNo = 0;

  constructor(private page: Page, private info: TestInfo) {}

  note(text: string) {
    this.lines.push(text);
  }

  check(ok: boolean, label: string, detail = '') {
    this.lines.push(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
    expect.soft(ok, `${label}${detail ? ` — ${detail}` : ''}`).toBe(true);
  }

  /** ⚠ vàng — không làm test lỗi */
  warn(label: string, detail = '') {
    this.lines.push(`⚠ ${label}${detail ? ` — ${detail}` : ''}`);
    this.info.annotations.push({ type: 'warning', description: `${label}${detail ? ` — ${detail}` : ''}` });
  }

  /** So 2 số tiền; lệch quá TOLERANCE → lỗi (soft: vẫn chạy tiếp các phần sau) */
  compare(label: string, actual: number, expected: number, expectedLabel = 'Tổng doanh thu') {
    const diff = actual - expected;
    const ok = Math.abs(diff) <= TOLERANCE;
    this.lines.push(`${ok ? '✔' : '✘'} ${label}: ${money(actual)}${ok ? '' : ` ≠ ${expectedLabel} ${money(expected)} (lệch ${money(diff)})`}`);
    expect.soft(Math.abs(diff), `${label}: ${money(actual)} ≠ ${expectedLabel} ${money(expected)} (lệch ${money(diff)})`).toBeLessThanOrEqual(TOLERANCE);
  }

  count(label: string, actual: number, expected: number, expectedLabel: string) {
    const ok = actual === expected;
    this.lines.push(`${ok ? '✔' : '✘'} ${label}: ${actual}${ok ? '' : ` ≠ ${expectedLabel} ${expected}`}`);
    expect.soft(actual, `${label}: ${actual} ≠ ${expectedLabel} ${expected}`).toBe(expected);
  }

  /** So nhãn tiền rút gọn trên màn hình với rule làm tròn */
  rounding(title: string, rows: { what: string; value: number; text: string }[], f: NumFmt) {
    const bad = rows
      .map((r) => ({ ...r, expected: ruleCompact(r.value, f) }))
      .filter((r) => !sameCompact(r.text, r.expected));
    if (!bad.length) {
      this.lines.push(`✔ Làm tròn — ${title}: ${rows.length} nhãn đúng rule (${rows.map((r) => r.text.trim()).join(', ')})`);
      return;
    }
    this.lines.push(`✘ Làm tròn — ${title}: ${bad.length}/${rows.length} nhãn sai rule`);
    for (const r of bad.slice(0, 12)) this.lines.push(`     ${r.what}: hiện "${r.text.trim()}" — đúng rule phải là "${r.expected}" (số gốc ${money(r.value)})`);
    if (bad.length > 12) this.lines.push(`     … và ${bad.length - 12} nhãn khác`);
    expect
      .soft(bad.length, `Làm tròn — ${title}: ${bad.map((r) => `"${r.text.trim()}" phải là "${r.expected}"`).join(', ')}`)
      .toBe(0);
  }

  roundingShape(title: string, texts: string[], f: NumFmt) {
    const bad = texts.map((t) => ({ t: t.trim(), err: compactShapeError(t, f) })).filter((x) => x.err);
    this.check(
      !bad.length,
      `Làm tròn — ${title}`,
      bad.length ? bad.map((x) => `"${x.t}": ${x.err}`).join('; ') : texts.map((t) => t.trim()).filter(Boolean).join(', '),
    );
  }

  /** target 'viewport' = chụp đúng khung đang nhìn (không cuộn / đổi kích thước trang) */
  async shot(name: string, target?: Locator | 'viewport') {
    const file = this.info.outputPath(`${String(++this.shotNo).padStart(2, '0')}-${name.replace(/[^\p{L}\d]+/gu, '-')}.png`);
    // Chờ hiệu ứng vẽ biểu đồ xong cho ảnh rõ
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

// ---------- trang tổng quan ----------

async function openOverview(page: Page, api: ApiLog, report: Report, opt: { defaultRange?: boolean; quiet?: boolean } = {}) {
  const since = api.mark();
  await page.goto('/reports/revenue');
  await expect(page, 'Bị chuyển về trang đăng nhập — phiên hết hạn?').not.toHaveURL(/\/auth\//);
  await expect(page, 'Không có quyền xem Báo cáo doanh thu').not.toHaveURL(/\/errors\/|approval-required/);

  const def = await api.firstRange(SUMMARY, since);
  const range: Range = opt.defaultRange ? def : { from: ENV_FROM || def.from, to: ENV_TO || def.to };

  if (range.from !== def.from || range.to !== def.to) {
    const inputs = page.locator('app-daterange-sidebar input');
    const steps: [number, string][] = range.from > def.to ? [[1, range.to], [0, range.from]] : [[0, range.from], [1, range.to]];
    for (const [i, iso] of steps) {
      const input = inputs.nth(i);
      await input.focus();
      await input.press('ArrowLeft');
      await input.press('ArrowLeft');
      await input.pressSequentially(vnDate(iso).replace(/\//g, ''));
      await expect(input, `Không gõ được ngày ${vnDate(iso)}`).toHaveValue(vnDate(iso));
    }
    await page.keyboard.press('Escape');
  }

  const summary = (await api.wait(SUMMARY, { range, since }))?.data;
  expect(summary, 'API tổng quan không trả dữ liệu').toBeTruthy();
  if (!opt.quiet) {
    report.note(`Khoảng ngày: ${vnDate(range.from)} → ${vnDate(range.to)}`);
    report.note(`Tổng doanh thu: ${money(summary.totalRevenue ?? 0)}`);
    report.note('');
  }
  return { range, summary, total: Number(summary.totalRevenue ?? 0), since };
}

const tabsBox = (page: Page) => page.locator('app-revenue-tabs');

const TAB_COMP: Record<string, string> = {
  'Cửa Hàng': 'app-revenue-store-tab',
  'Sản Phẩm': 'app-revenue-product-tab',
  'Nhân Viên': 'app-revenue-employee-tab',
  'Kênh Bán': 'app-revenue-channel-tab',
};

/** Mở tab; tab đang mở sẵn thì chuyển qua tab khác rồi quay lại để trang tải lại biểu đồ (gọi API sau api.mark()) */
async function openTab(page: Page, label: string) {
  const box = tabsBox(page);
  const click = (l: string) => box.getByRole('tab', { name: l, exact: true }).or(box.getByText(l, { exact: true })).first().click();
  const comp = page.locator(TAB_COMP[label]);
  if (await comp.count()) {
    await click(Object.keys(TAB_COMP).find((l) => l !== label)!);
    await expect(comp).toHaveCount(0);
  }
  await click(label);
  await expect(comp, `Không mở được tab ${label}`).toHaveCount(1);
}

/** amf-select / amf-tooltip tự đóng khi trang cuộn → cuộn tới trước, đứng yên rồi mới hover / bấm */
async function settle(target: Locator) {
  // giữa màn hình → khung xổ xuống (position: fixed) không bị tràn khỏi màn hình
  await target.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await target.page().waitForTimeout(300);
}

/** Nhãn tên dưới từng cột */
async function xLabels(comp: Locator, count: number) {
  // khung ngoài của tab cũng có pt-3 (chứa ô chọn) → chỉ lấy hàng nhãn dưới cột
  const spans = comp.locator('div.pt-3:not(.flex-col) span.truncate');
  await expect.poll(async () => (await spans.allTextContents()).filter((t) => t.trim()).length, { timeout: 5_000 }).toBe(count).catch(() => {});
  return (await spans.allTextContents()).map((t) => t.trim());
}

/**
 * Biểu đồ cột trong tab: số trên cột + trục Y đúng rule làm tròn, tooltip hiện đủ số tiền,
 * tối đa `maxVisible` cột trên 1 màn hình (nhiều hơn → cuộn ngang).
 */
async function checkBarChart(
  page: Page,
  report: Report,
  tab: { label: string; comp: string; cls: string; maxVisible: number; name?: (it: any) => string },
  data: any,
  f: NumFmt,
) {
  const items: any[] = data?.items ?? [];
  const comp = page.locator(tab.comp);
  const values = comp.locator(`.${tab.cls}-bar-value`);
  await expect(values, `Tab ${tab.label}: số cột trên màn hình khác số dòng API (${items.length})`).toHaveCount(items.length);
  await tabsBox(page).scrollIntoViewIfNeeded();

  const labels = await xLabels(comp, items.length);
  const nameOf = (i: number) => tab.name?.(items[i]) || labels[i]?.trim() || `#${i + 1}`;

  const texts = await values.allTextContents();
  report.rounding(
    'số trên cột',
    items.map((it, i) => ({ what: nameOf(i), value: Number(it.revenue ?? 0), text: texts[i] ?? '' })),
    f,
  );

  const axis = (await comp.locator('div.mt-6.h-70 > span').allTextContents()).map((t) => t.trim());
  const max = resolveMax(Number(data?.maxRevenue ?? 0), items);
  report.rounding(
    'trục Y',
    TICK_RATIOS.map((r, i) => ({ what: `mốc ${Math.round(r * 100)}%`, value: max * r, text: axis[i] ?? '' })),
    f,
  );

  // Số cột hiển thị trong khung (tâm cột nằm trong khung nhìn) + có cuộn ngang không
  const layout = await comp.evaluate((root, cls) => {
    const sc = root.querySelector('[class*="chart-scroll"]') as HTMLElement | null;
    const box = (sc ?? root).getBoundingClientRect();
    const centers = [...root.querySelectorAll(`.${cls}-bar-value`)].map((e) => {
      const r = e.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    return { overflow: sc ? sc.scrollWidth - sc.clientWidth : 0, visible: centers.filter((x) => x >= box.left && x <= box.right).length };
  }, tab.cls);
  const n = items.length;
  if (n > tab.maxVisible) {
    report.check(
      layout.overflow > 1 && layout.visible === tab.maxVisible,
      `${n} cột > ${tab.maxVisible} → hiện ${tab.maxVisible} cột, còn lại cuộn ngang`,
      layout.overflow > 1 ? `đang hiện ${layout.visible} cột` : 'không có thanh cuộn ngang',
    );
  } else {
    report.check(
      layout.overflow <= 1 && layout.visible === n,
      `${n} cột (≤ ${tab.maxVisible}) → hiện đủ, không cuộn`,
      layout.overflow > 1 ? 'vẫn có thanh cuộn ngang' : `đang hiện ${layout.visible}/${n} cột`,
    );
  }
  await report.shot(`Tab ${tab.label}`, tabsBox(page));
  if (layout.overflow > 1) {
    await comp.locator('[class*="chart-scroll"]').evaluate((e) => (e.scrollLeft = e.scrollWidth));
    await report.shot(`Tab ${tab.label} — cuộn sang phải`, tabsBox(page));
    await comp.locator('[class*="chart-scroll"]').evaluate((e) => (e.scrollLeft = 0));
  }

  // Hover cột → tooltip hiện đủ số tiền
  const i = items.findIndex((it) => Number(it.revenue ?? 0) > 0);
  if (i < 0) {
    report.warn(`Tab ${tab.label}: không có cột nào có doanh thu để thử tooltip`);
    return;
  }
  const bar = comp.locator(`.${tab.cls}-bar`).nth(i);
  const tip = comp.getByRole('tooltip').filter({ hasText: 'Doanh thu:' });
  let shown: string | null = null;
  for (let attempt = 0; attempt < 3 && !shown; attempt++) {
    await page.mouse.move(0, 0);
    await settle(bar);
    await bar.hover();
    shown = await tip.first().textContent({ timeout: 2_000 }).catch(() => null);
  }
  if (!shown) {
    report.check(false, `Tooltip khi hover cột "${nameOf(i)}"`, 'không hiện');
  } else {
    const line = shown.match(/Doanh thu:.*$/)?.[0] ?? shown;
    report.compare(`Tooltip "${nameOf(i)}" (${line.replace(/\s+/g, ' ').trim()})`, parseMoney(line), Number(items[i].revenue), 'API');
    // chụp theo khung / cả trang sẽ cuộn hoặc đổi kích thước trang → tooltip tắt
    await report.shot(`Tab ${tab.label} — tooltip`, 'viewport');
  }
  await page.mouse.move(0, 0);
}

// ---------- trang chi tiết ----------

/** Đọc bảng chi tiết qua mọi trang (chụp từng trang); trả dữ liệu API + các cột cần đọc trên màn hình */
async function readDetailTable(
  page: Page,
  api: ApiLog,
  report: Report,
  reportPath: string,
  title: string,
  opt: { since: number; range?: Range; pred?: (u: URL) => boolean; columns: string[]; shotTitle?: string },
) {
  await expect(page, `Không vào được trang "${title}" (bị chặn quyền / lỗi)`).not.toHaveURL(/\/errors\/|\/auth\//);
  await expect(page.getByText(title, { exact: true }).first(), `Không thấy tiêu đề "${title}"`).toBeVisible();

  const items: any[] = [];
  const cols: string[][] = [];
  let total = 0;
  let since = opt.since;
  for (let pageNo = 1; ; pageNo++) {
    const body = await api.wait(reportPath, { range: opt.range, params: { page: String(pageNo) }, pred: opt.pred, since });
    const pageItems: any[] = body?.items ?? [];
    total = Number(body?.total ?? pageItems.length);
    items.push(...pageItems);

    // chờ bảng hiện đủ số dòng API trả về
    const read = () =>
      page.evaluate((columns) => {
        const heads = [...document.querySelectorAll('thead th')].map((th) => th.textContent!.trim().toLowerCase());
        const idx = columns.map((c) => heads.indexOf(c));
        if (idx.some((i) => i < 0)) return null;
        return [...document.querySelectorAll('tbody tr')]
          .filter((tr) => !tr.querySelector('td[colspan]') && tr.children.length > Math.max(...idx))
          .map((tr) => idx.map((i) => tr.children[i]?.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
      }, opt.columns);
    await expect
      .poll(async () => (await read())?.length, { message: `Bảng "${title}" trang ${pageNo} không hiện đủ ${pageItems.length} dòng` })
      .toBe(pageItems.length);
    cols.push(...((await read()) ?? []));
    // bảng có thanh cuộn riêng → mở hết chiều cao để ảnh thấy đủ mọi dòng (chỉ đổi hiển thị)
    await page.locator('table').last().evaluate((t) => {
      for (let el = t.parentElement; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).overflowY !== 'visible') el.style.maxHeight = 'none';
      }
    });
    await report.shot(`${opt.shotTitle ?? title} — trang ${pageNo}`);

    const next = page.getByTitle('Trang sau');
    if (!(await next.isVisible()) || (await next.isDisabled())) break;
    since = api.mark();
    await next.click();
  }
  return { items, cols, total };
}

async function checkDetailTable(page: Page, api: ApiLog, report: Report, range: Range, total: number, reportPath: string, title: string, since: number) {
  const { items, cols, total: totalRows } = await readDetailTable(page, api, report, reportPath, title, { since, range, columns: ['doanh thu'] });
  const uiTotal = cols.reduce((s, [t]) => s + parseMoney(t), 0);
  report.count(`Số dòng trên bảng`, cols.length, totalRows, 'tổng số dòng');
  report.compare(`Cộng cột Doanh Thu (${cols.length} dòng)`, uiTotal, total);
  report.compare(`Cột Doanh Thu trên màn hình so với dữ liệu API`, uiTotal, sum(items, 'revenue'), 'API');
  return items;
}

// ---------- bộ lọc ----------

/** Chọn / bỏ chọn các mục trong ô chọn nhiều (amf-select) rồi bấm "Chọn" */
async function toggleOptions(comp: Locator, names: string[]) {
  const sel = comp.locator('amf-select');
  const trigger = sel.locator('button').first();
  // khung xổ xuống bị chuyển ra <body> → tìm trên cả trang
  const page = comp.page();
  const panel = page
    .locator('div.fixed:visible')
    .filter({ has: page.getByPlaceholder('Tìm kiếm...') })
    .filter({ has: page.getByRole('button', { name: 'Chọn', exact: true }) })
    .last();
  for (let attempt = 0; attempt < 3 && !(await panel.isVisible()); attempt++) {
    await settle(trigger);
    await trigger.click();
    await panel.waitFor({ timeout: 2_000 }).catch(() => {});
  }
  await expect(panel, 'Không mở được ô chọn').toBeVisible();
  const search = panel.getByPlaceholder('Tìm kiếm...');
  for (const name of names) {
    await search.fill(name);
    await panel.getByRole('button', { name, exact: true }).first().click();
  }
  await search.fill('');
  await panel.getByRole('button', { name: 'Chọn', exact: true }).click();
  await expect(panel).toBeHidden();
}

/** Chọn danh mục trong cây danh mục (gõ tìm rồi bấm đúng tên) */
async function pickCategory(scope: Locator, name: string) {
  const tree = scope.locator('app-category-tree');
  await settle(tree);
  await tree.locator('button').first().click();
  await tree.getByPlaceholder('Tìm kiếm danh mục...').fill(name);
  await tree.getByText(name, { exact: true }).last().click();
}

interface Snapshot {
  total: number;
  orders: number;
  payment: Map<string, { name: string; rev: number }>;
  tabs: Map<string, Map<string, { name: string; rev: number }>>;
  product: Map<string, { name: string; rev: number }>;
}

/** Chụp số liệu hiện tại (khoảng ngày mặc định → có hôm nay) */
async function snapshot(page: Page, api: ApiLog, report: Report, category: string, when: string): Promise<Snapshot> {
  const { range, summary } = await openOverview(page, api, report, { defaultRange: true, quiet: true });
  const payItems: any[] = (await api.wait(PAYMENT, { range }))?.data ?? [];
  await report.shot(`${when} — tổng quan`);
  const snap: Snapshot = {
    total: Number(summary.totalRevenue ?? 0),
    orders: Number(summary.totalOrders ?? 0),
    payment: new Map(payItems.map((p) => [norm(p.name), { name: p.name, rev: Number(p.revenue ?? 0) }])),
    tabs: new Map(),
    product: new Map(),
  };
  for (const tab of TABS) {
    const since = api.mark();
    await openTab(page, tab.label);
    const items: any[] = (await api.wait(tab.chart, { range, since, pred: hasNone([tab.filterParam]) }))?.data?.items ?? [];
    const comp = page.locator(tab.comp);
    await expect(comp.locator(`.${tab.cls}-bar-value`)).toHaveCount(items.length);
    const labels = await xLabels(comp, items.length);
    snap.tabs.set(tab.label, new Map(items.map((it, i) => [tab.id(it), { name: tab.name?.(it) || labels[i]?.trim() || '', rev: Number(it.revenue ?? 0) }])));
  }
  let since = api.mark();
  await openTab(page, PRODUCT_TAB.label);
  let data = (await api.wait(PRODUCT_CHART, { range, since, pred: hasNone(CATEGORY_PARAMS) }))?.data;
  if (category) {
    since = api.mark();
    await pickCategory(page.locator(PRODUCT_TAB.comp), category);
    data = (await api.wait(PRODUCT_CHART, { range, since, pred: hasAny(CATEGORY_PARAMS) }))?.data;
  }
  const items: any[] = data?.items ?? [];
  await expect(page.locator(PRODUCT_TAB.comp).locator('.store-bar-value')).toHaveCount(items.length);
  snap.product = new Map(items.map((it) => [String(it.productId), { name: it.productName, rev: Number(it.revenue ?? 0) }]));
  await report.shot(`${when} — tab Sản Phẩm${category ? ` (lọc ${category})` : ''}`, tabsBox(page));
  return snap;
}

function changes(before: Map<string, { name: string; rev: number }>, after: Map<string, { name: string; rev: number }>) {
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids]
    .map((id) => ({ id, name: after.get(id)?.name || before.get(id)?.name || id, delta: (after.get(id)?.rev ?? 0) - (before.get(id)?.rev ?? 0) }))
    .filter((c) => Math.abs(c.delta) > TOLERANCE);
}

// ---------- kịch bản ----------

test.describe('Doanh thu', () => {
  test('1. Tổng quan — Tổng doanh thu & theo thời gian', async ({ page, api, report }) => {
    const { range, summary, total } = await openOverview(page, api, report);
    const f = await readFmt(page);
    report.note(`Cài đặt số của hệ thống: thập phân "${f.decimal}", phân cách nghìn "${f.thousand}"`);

    // Ô tổng (Tổng doanh thu, Giá vốn) hiện số rút gọn đúng rule
    const cards = [
      { label: 'Tổng doanh thu', value: total },
      { label: 'Giá vốn hàng bán', value: Number(summary.costOfGoods ?? 0) },
    ];
    const rows = [];
    for (const c of cards) {
      const card = page.locator('.dash-card').filter({ hasText: new RegExp(c.label, 'i') }).first();
      await expect(card.locator('.animate-pulse')).toHaveCount(0);
      rows.push({ what: `Ô "${c.label}"`, value: c.value, text: (await card.locator('div.mt-1').textContent()) ?? '' });
    }
    report.rounding('ô tổng', rows, f);
    await report.shot('Tổng quan');

    // Biểu đồ theo thời gian
    const chart = (await api.wait(CHART, { range }))?.data?.items ?? [];
    report.compare(`Theo thời gian — cộng ${chart.length} mốc`, sum(chart, 'revenue'), total);
    report.count('Đơn hàng theo thời gian', sum(chart, 'totalOrders'), Number(summary.totalOrders ?? 0), 'ô Đơn hàng');
    report.count('Đơn hàng huỷ theo thời gian', sum(chart, 'cancelledOrders'), Number(summary.cancelledOrders ?? 0), 'ô Đơn hàng huỷ');
    const timeCard = page.locator('.dash-card').filter({ hasText: 'Doanh thu theo thời gian' }).first();
    const axis = await timeCard.locator('div.justify-between > span').allTextContents();
    report.roundingShape('trục Y biểu đồ theo thời gian', axis, f);
    await report.shot('Doanh thu theo thời gian', timeCard);
  });

  test('2. Phương thức thanh toán — biểu đồ tròn', async ({ page, api, report }) => {
    const { range, total } = await openOverview(page, api, report);
    const f = await readFmt(page);
    const card = page.locator('.dash-card').filter({ hasText: 'Phương Thức Thanh Toán' }).first();

    const items: any[] = (await api.wait(PAYMENT, { range }))?.data ?? [];
    // số trên chú thích (mỗi PTTT 1 dòng: tên + số tiền)
    const legend = card.locator('strong');
    await expect.poll(() => legend.count(), { message: 'Chú thích PTTT không hiện đủ' }).toBe(items.length);
    const texts = await legend.allTextContents();
    for (const [i, it] of items.entries()) report.note(`   ${it.name}: ${texts[i]?.trim()}`);
    report.compare('Cộng các PTTT trên màn hình', texts.reduce((s, t) => s + parseMoney(t), 0), total);

    const center = (await card.locator('[data-payment-share-chart] div.mt-2').textContent()) ?? '';
    report.rounding('số "Tổng" giữa biểu đồ tròn', [{ what: 'Tổng', value: sum(items, 'revenue'), text: center }], f);
    await report.shot('Phương thức thanh toán', card);
  });

  test('3. Phương thức thanh toán — Xem chi tiết', async ({ page, api, report }) => {
    const { range, total } = await openOverview(page, api, report);
    const card = page.locator('.dash-card').filter({ hasText: 'Phương Thức Thanh Toán' }).first();
    const since = api.mark();
    await card.getByRole('link', { name: /Xem Chi Tiết/i }).click();
    await checkDetailTable(page, api, report, range, total, 'reports/revenue/payment-method/report', 'Doanh Thu Theo Phương Thức Thanh Toán', since);
  });

  for (const [i, tab] of TABS.entries()) {
    const no = 4 + i * 2;

    test(`${no}. Tab ${tab.label}`, async ({ page, api, report }) => {
      const { range, total } = await openOverview(page, api, report);
      const f = await readFmt(page);
      const since = api.mark();
      await openTab(page, tab.label);
      const data = (await api.wait(tab.chart, { range, since }))?.data;
      const items: any[] = data?.items ?? [];
      report.compare(`Tab ${tab.label} — cộng ${items.length} dòng`, sum(items, 'revenue'), total);
      await checkBarChart(page, report, tab, data, f);
    });

    test(`${no + 1}. Tab ${tab.label} — Xem chi tiết`, async ({ page, api, report }) => {
      const { range, total } = await openOverview(page, api, report);
      await openTab(page, tab.label);
      const since = api.mark();
      await tabsBox(page).getByRole('link', { name: /Xem Chi Tiết/i }).click();
      await checkDetailTable(page, api, report, range, total, tab.detail.report, tab.detail.title, since);
    });
  }

  test('10. Tab Sản Phẩm — Top 10', async ({ page, api, report }) => {
    const { range } = await openOverview(page, api, report);
    const f = await readFmt(page);
    const since = api.mark();
    await openTab(page, PRODUCT_TAB.label);
    const data = (await api.wait(PRODUCT_CHART, { range, since }))?.data;
    const items: any[] = data?.items ?? [];
    const totalProducts = Number(data?.totalProducts ?? 0);

    report.count(`Số sản phẩm trên biểu đồ (tối đa ${PRODUCT_TOP})`, items.length, Math.min(PRODUCT_TOP, totalProducts), `min(${PRODUCT_TOP}, ${totalProducts} sản phẩm)`);
    const unsorted = items.findIndex((it, i) => i > 0 && Number(items[i - 1].revenue) < Number(it.revenue));
    report.check(unsorted < 0, 'Sắp xếp doanh thu giảm dần', unsorted < 0 ? '' : `"${items[unsorted].productName}" đứng sau sản phẩm có doanh thu thấp hơn`);
    const sold = items.filter((it) => Number(it.revenue) > 0).length;
    report.note(`   ${sold} sản phẩm có doanh thu, ${items.length - sold} sản phẩm 0đ (chưa có đơn)`);
    const footer = page.locator(PRODUCT_TAB.comp).getByText(/Top \d+\/\d+ sản phẩm/);
    await expect.soft(footer, 'Dòng "Top x/y sản phẩm" sai').toHaveText(new RegExp(`Top ${items.length}/${totalProducts} sản phẩm`));
    await checkBarChart(page, report, PRODUCT_TAB, data, f);
  });

  test('11. Tab Sản Phẩm — Xem chi tiết', async ({ page, api, report }) => {
    const { range, total } = await openOverview(page, api, report);
    let since = api.mark();
    await openTab(page, PRODUCT_TAB.label);
    const chart: any[] = (await api.wait(PRODUCT_CHART, { range, since }))?.data?.items ?? [];
    since = api.mark();
    await tabsBox(page).getByRole('link', { name: /Xem Chi Tiết/i }).click();
    const rows = await checkDetailTable(page, api, report, range, total, PRODUCT_REPORT, PRODUCT_TITLE, since);

    // Biểu đồ Top 10 phải khớp bảng chi tiết (bảng chia theo sản phẩm × cửa hàng → cộng theo sản phẩm)
    const byProduct = new Map<string, { name: string; rev: number }>();
    for (const r of rows) {
      const cur = byProduct.get(String(r.productId)) ?? { name: r.productName, rev: 0 };
      cur.rev += Number(r.revenue ?? 0);
      byProduct.set(String(r.productId), cur);
    }
    const onChart = chart.filter((it) => Number(it.revenue) > 0);
    for (const it of onChart) {
      report.compare(`Biểu đồ "${it.productName}" = cộng các dòng chi tiết`, Number(it.revenue), byProduct.get(String(it.productId))?.rev ?? 0, 'bảng chi tiết');
    }
    const chartIds = new Set(chart.map((it) => String(it.productId)));
    const floor = onChart.length >= PRODUCT_TOP ? Math.min(...onChart.map((it) => Number(it.revenue))) : 0;
    const missing = [...byProduct.entries()].filter(([id, p]) => !chartIds.has(id) && p.rev > floor + TOLERANCE);
    report.check(
      !missing.length,
      `Top ${PRODUCT_TOP} trên biểu đồ đúng là ${PRODUCT_TOP} sản phẩm doanh thu cao nhất`,
      missing.map(([, p]) => `thiếu "${p.name}" (${money(p.rev)})`).join(', '),
    );
  });

  for (const [i, tab] of TABS.entries()) {
    test(`${12 + i}. Bộ lọc — Tab ${tab.label}`, async ({ page, api, report }) => {
      const { range } = await openOverview(page, api, report);
      const comp = page.locator(tab.comp);
      let since = api.mark();
      await openTab(page, tab.label);
      const all: any[] = (await api.wait(tab.chart, { range, since, pred: hasNone([tab.filterParam]) }))?.data?.items ?? [];
      await expect(comp.locator(`.${tab.cls}-bar-value`)).toHaveCount(all.length);
      const labels = await xLabels(comp, all.length);
      const named = all.map((it, k) => ({ it, name: (tab.name?.(it) || labels[k] || '').trim() }));
      const dup = new Map<string, number>();
      for (const x of named) dup.set(x.name, (dup.get(x.name) ?? 0) + 1);
      const pick = named
        .filter((x) => x.name && dup.get(x.name) === 1)
        .sort((a, b) => Number(b.it.revenue) - Number(a.it.revenue))
        .slice(0, 2);
      if (!pick.length) {
        report.warn(`Không có ${tab.noun} nào tên không trùng để thử lọc`);
        return;
      }
      report.note(`Lọc theo ${pick.length} ${tab.noun}: ${pick.map((p) => p.name).join(', ')}`);

      since = api.mark();
      await toggleOptions(comp, pick.map((p) => p.name));
      const ids = pick.map((p) => tab.id(p.it));
      const filtered: any[] = (await api.wait(tab.chart, { range, since, params: { [tab.filterParam]: ids } }))?.data?.items ?? [];
      report.count('Số cột sau khi lọc', filtered.length, pick.length, `số ${tab.noun} đã chọn`);
      for (const p of pick) {
        const got = filtered.find((x) => tab.id(x) === tab.id(p.it));
        report.compare(`Doanh thu "${p.name}" sau khi lọc`, Number(got?.revenue ?? 0), Number(p.it.revenue), 'lúc chưa lọc');
      }
      await expect.soft(comp.locator(`.${tab.cls}-bar-value`), 'Số cột trên màn hình sau khi lọc').toHaveCount(pick.length);
      await expect.soft(comp.getByText(/Hiển thị \d+\//), 'Dòng "Hiển thị x/y"').toContainText(`Hiển thị ${pick.length}/`);
      await report.shot(`Lọc ${tab.label}`, tabsBox(page));

      since = api.mark();
      await toggleOptions(comp, pick.map((p) => p.name));
      const back: any[] = (await api.wait(tab.chart, { range, since, pred: hasNone([tab.filterParam]) }))?.data?.items ?? [];
      report.count('Bỏ lọc → số cột', back.length, all.length, 'lúc chưa lọc');
      await expect.soft(comp.locator(`.${tab.cls}-bar-value`)).toHaveCount(all.length);
      await report.shot(`Bỏ lọc ${tab.label}`, tabsBox(page));
    });
  }

  test('15. Bộ lọc — Tab Sản Phẩm (Danh Mục)', async ({ page, api, report }) => {
    const { range } = await openOverview(page, api, report);
    let since = api.mark();
    await openTab(page, PRODUCT_TAB.label);
    await api.wait(PRODUCT_CHART, { range, since });

    // Lấy danh mục của dòng bán chạy nhất ở trang chi tiết
    since = api.mark();
    await tabsBox(page).getByRole('link', { name: /Xem Chi Tiết/i }).click();
    const first = await api.wait(PRODUCT_REPORT, { range, since, params: { page: '1' } });
    const top = (first?.items ?? []).find((r: any) => Number(r.revenue) > 0 && r.categoryName);
    if (!top) {
      report.warn('Chưa có sản phẩm nào có doanh thu + danh mục để thử lọc');
      return;
    }
    const leaf = String(top.categoryName).split('>').pop()!.trim();
    report.note(`Danh mục thử lọc: "${leaf}" (của "${top.productName}")`);
    report.note('');

    // Trang chi tiết: lọc danh mục → mọi dòng thuộc danh mục đó
    const detail = page.locator('app-revenue-product-detail');
    since = api.mark();
    await pickCategory(detail, leaf);
    const { cols } = await readDetailTable(page, api, report, PRODUCT_REPORT, PRODUCT_TITLE, {
      since, range, pred: hasAny(CATEGORY_PARAMS), columns: ['danh mục', 'sản phẩm'], shotTitle: `Chi tiết lọc "${leaf}"`,
    });
    const wrong = cols.filter(([cat]) => !norm(cat).endsWith(norm(leaf)));
    report.check(
      cols.length > 0 && !wrong.length,
      `Trang chi tiết lọc "${leaf}": ${cols.length} dòng đều thuộc danh mục`,
      cols.length ? wrong.slice(0, 5).map(([cat, p]) => `"${p}" thuộc "${cat}"`).join(', ') : 'không còn dòng nào',
    );
    since = api.mark();
    await detail.getByRole('button', { name: 'Đặt Lại', exact: true }).click();
    await api.wait(PRODUCT_REPORT, { since, pred: hasNone(CATEGORY_PARAMS) });
    report.check(true, 'Trang chi tiết: bấm "Đặt Lại" → bỏ lọc danh mục');
    await report.shot('Chi tiết — Đặt Lại');

    // Tab Sản Phẩm trên trang tổng quan
    const again = await openOverview(page, api, report, { quiet: true });
    const comp = page.locator(PRODUCT_TAB.comp);
    since = api.mark();
    await openTab(page, PRODUCT_TAB.label);
    const all = (await api.wait(PRODUCT_CHART, { range: again.range, since, pred: hasNone(CATEGORY_PARAMS) }))?.data;
    since = api.mark();
    await pickCategory(comp, leaf);
    const filtered = (await api.wait(PRODUCT_CHART, { range: again.range, since, pred: hasAny(CATEGORY_PARAMS) }))?.data;
    const items: any[] = filtered?.items ?? [];
    const totalProducts = Number(filtered?.totalProducts ?? 0);
    await expect(comp.locator('.store-bar-value'), 'Số cột sau khi lọc danh mục').toHaveCount(items.length);
    report.count('Số cột sau khi lọc danh mục', items.length, Math.min(PRODUCT_TOP, totalProducts), `min(${PRODUCT_TOP}, ${totalProducts} sản phẩm của danh mục)`);
    report.check(totalProducts <= Number(all?.totalProducts ?? 0), `Số sản phẩm của danh mục (${totalProducts}) ≤ tất cả (${all?.totalProducts ?? 0})`);
    report.check(
      items.some((it) => String(it.productId) === String(top.productId)),
      `"${top.productName}" có trên biểu đồ sau khi lọc "${leaf}"`,
    );
    const allRev = new Map<string, number>((all?.items ?? []).map((it: any) => [String(it.productId), Number(it.revenue)]));
    for (const it of items.filter((x) => allRev.has(String(x.productId)) && Number(x.revenue) > 0)) {
      report.compare(`"${it.productName}" sau khi lọc`, Number(it.revenue), allRev.get(String(it.productId))!, 'lúc chưa lọc');
    }
    await expect.soft(comp.locator('app-category-tree'), 'Ô Danh Mục không hiện danh mục đã chọn').toContainText(leaf);
    await report.shot(`Tab Sản Phẩm lọc "${leaf}"`, tabsBox(page));

    since = api.mark();
    await comp.getByRole('button', { name: 'Đặt Lại', exact: true }).click();
    const back = (await api.wait(PRODUCT_CHART, { range: again.range, since, pred: hasNone(CATEGORY_PARAMS) }))?.data;
    report.count('Bấm "Đặt Lại" → số cột', (back?.items ?? []).length, (all?.items ?? []).length, 'lúc chưa lọc');
    await report.shot('Tab Sản Phẩm — Đặt Lại', tabsBox(page));
  });

  test('16. Tạo đơn bán tại quầy → số liệu tăng đúng', async ({ page, api, report }) => {
    test.skip(!CREATE_ORDER, 'Đã tắt tạo đơn (REVENUE_CREATE_ORDER=0)');
    test.setTimeout(300_000);

    // đơn được tính cho người đang đăng nhập (CreatedBy = refCode của tài khoản)
    let me: { refCode?: string; name?: string } = {};
    page.on('response', async (r) => {
      if (!r.url().includes('/auth/current-user')) return;
      const j = await r.json().catch(() => null);
      const u = j?.data ?? j;
      if (u?.refCode) me = { refCode: String(u.refCode), name: u.fullName || u.userName };
    });

    const pos = await openPos(page);
    const product = ORDER_PRODUCT ? await findOnPos(page, ORDER_PRODUCT, pos.products, ORDER_PRODUCT_ID) : pickProduct(pos.products);
    expect(product, ORDER_PRODUCT ? `Không thấy sản phẩm "${ORDER_PRODUCT}" ở màn hình bán tại quầy` : 'Không có sản phẩm nào còn hàng để tạo đơn').toBeTruthy();
    const category = [product!.categoryNameLevel3, product!.categoryNameLevel2, product!.categoryNameLevel1].find((c) => c?.trim())?.trim() ?? '';
    report.note(`Cửa hàng: ${pos.storeName || '(đã chọn sẵn)'}`);
    report.note(`Sản phẩm bán: "${product!.productName}" — ${money(Number(product!.price))}${category ? ` — danh mục "${category}"` : ''}`);

    const before = await snapshot(page, api, report, category, 'Trước khi tạo đơn');
    const productBefore = before.product.get(String(product!.productId))?.rev ?? 0;
    report.note(`Trước: Tổng doanh thu ${money(before.total)}, ${before.orders} đơn, "${product!.productName}" ${money(productBefore)}`);

    await openPos(page);
    const order = await sell(page, [{ product: product!, qty: 1 }], (name, target) => report.shot(name, target));
    const A = order.revenue;
    report.note(`✔ Đã tạo đơn ${order.orderCode} (id ${order.orderId}) — khách trả ${money(order.paid)}, trả tiền mặt`);
    report.note(`   Doanh thu phải tăng ${money(A)} (không tính VAT${order.paid !== A ? `, lệch với tiền khách trả ${money(order.paid - A)}` : ''})`);
    report.note(`   Người tạo đơn: ${me.name ?? '?'} (${me.refCode ?? 'không đọc được refCode'})`);
    report.note('');

    const after = await snapshot(page, api, report, category, 'Sau khi tạo đơn');

    report.compare('Tổng doanh thu tăng thêm', after.total - before.total, A, 'doanh thu đơn');
    report.count('Số đơn hàng tăng thêm', after.orders - before.orders, 1, 'đơn vừa tạo');

    const cash = changes(before.payment, after.payment);
    const cashRow = cash.find((c) => norm(c.name) === 'tiền mặt');
    report.compare('PTTT "Tiền mặt" tăng thêm', cashRow?.delta ?? 0, A, 'doanh thu đơn');

    const expectName: Record<string, string> = { 'Cửa Hàng': pos.storeName, 'Kênh Bán': 'Bán hàng tại quầy' };
    for (const tab of TABS) {
      const b = before.tabs.get(tab.label)!;
      const a = after.tabs.get(tab.label)!;
      const diff = changes(b, a);
      let row: { id: string; name: string; delta: number } | undefined;
      let label: string;
      if (tab.label === 'Nhân Viên') {
        expect.soft(me.refCode, 'Không đọc được tài khoản đang đăng nhập (auth/current-user) để biết nhân viên tạo đơn').toBeTruthy();
        const id = me.refCode ?? '';
        row = { id, name: a.get(id)?.name || b.get(id)?.name || me.name || id, delta: (a.get(id)?.rev ?? 0) - (b.get(id)?.rev ?? 0) };
        if (!a.has(id)) report.check(false, `Tab Nhân Viên có người tạo đơn "${row.name}"`, 'không có cột của tài khoản đang đăng nhập');
        label = `"${row.name}" (người tạo đơn)`;
      } else {
        const want = expectName[tab.label];
        row = diff.find((c) => norm(c.name) === norm(want));
        label = `"${row?.name ?? want}"`;
      }
      report.compare(`Tab ${tab.label} — ${label} tăng thêm`, row?.delta ?? 0, A, 'doanh thu đơn');
      report.compare(`Tab ${tab.label} — cộng các cột sau khi tạo đơn`, [...a.values()].reduce((s, x) => s + x.rev, 0), after.total);
      const others = diff.filter((c) => c.id !== row?.id);
      if (others.length) report.warn(`Tab ${tab.label}: có ${tab.noun} khác cũng thay đổi (có thể do người khác tạo đơn cùng lúc)`, others.map((c) => `${c.name} ${money(c.delta)}`).join(', '));
    }

    const productAfter = after.product.get(String(product!.productId))?.rev;
    if (productAfter === undefined) {
      report.check(false, `"${product!.productName}" có trên biểu đồ Top ${PRODUCT_TOP} tab Sản Phẩm${category ? ` (lọc "${category}")` : ''}`, 'không thấy sau khi tạo đơn');
    } else {
      if (productBefore <= 0) report.check(true, `"${product!.productName}" đã lên biểu đồ tab Sản Phẩm sau khi có đơn`);
      report.compare(`Tab Sản Phẩm — "${product!.productName}" tăng thêm`, productAfter - productBefore, A, 'doanh thu đơn');
    }
  });
});
