import { Locator, Page, Response, TestInfo } from '@playwright/test';
import { expect, test as base } from '../shared-page';

/**
 * Kiểm tra ĐỒNG BỘ số liệu doanh thu trên trang Báo cáo doanh thu (/reports/revenue) — chỉ xem, không tạo / sửa / xoá.
 *
 * Thao tác trên giao diện như người dùng: mở trang, (tuỳ chọn) gõ khoảng ngày, bấm từng tab, bấm "Xem Chi Tiết"
 * rồi đọc số trên màn hình. Mỗi phần là 1 test riêng (1 thẻ trên trang điều khiển) kèm ảnh chụp từng bước:
 *   1. Tổng quan         — ô "Tổng doanh thu" + biểu đồ theo thời gian (doanh thu, số đơn, đơn huỷ)
 *   2. PTTT              — biểu đồ tròn "Phương Thức Thanh Toán" (số trên chú thích)
 *   3. PTTT chi tiết     — bảng "Doanh Thu Theo Phương Thức Thanh Toán" (cộng cột Doanh Thu mọi trang)
 *   4+. Tab Cửa Hàng / Nhân Viên / Kênh Bán — biểu đồ trong tab + trang "Xem Chi Tiết" của tab
 *   Tab Sản Phẩm         — chưa có dữ liệu (placeholder) → chỉ chụp ảnh
 * Mỗi phần phải cộng lại bằng Tổng doanh thu (lệch tối đa TOLERANCE đồng do làm tròn).
 *
 * Khoảng ngày: mặc định của trang (1 tháng gần nhất). Đổi bằng REVENUE_FROM / REVENUE_TO (YYYY-MM-DD).
 */

const TOLERANCE = 1; // đồng
const ENV_FROM = process.env.REVENUE_FROM || '';
const ENV_TO = process.env.REVENUE_TO || '';

const SUMMARY = 'reports/revenue/overview/summary';
const CHART = 'reports/revenue/overview/chart';
const PAYMENT = 'reports/revenue/overview/payment-methods';

interface Range { from: string; to: string }

interface TabCase {
  label: string;
  chart: string;
  detail: { report: string; title: string };
}

const TABS: TabCase[] = [
  { label: 'Cửa Hàng', chart: 'reports/revenue/store/chart', detail: { report: 'reports/revenue/store/report', title: 'Doanh Thu Theo Cửa Hàng' } },
  { label: 'Nhân Viên', chart: 'reports/revenue/employee/chart', detail: { report: 'reports/revenue/employee/report', title: 'Doanh Thu Theo Nhân Viên' } },
  { label: 'Kênh Bán', chart: 'reports/revenue/channel/chart', detail: { report: 'reports/revenue/channel/report', title: 'Doanh Thu Theo Kênh Bán' } },
];

// ---------- tiện ích ----------

const money = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const sum = (rows: any[] | undefined, key: string) => (rows ?? []).reduce((s, r) => s + Number(r?.[key] ?? 0), 0);
const vnDate = (iso: string) => iso.split('-').reverse().join('/');

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

function compactMoney(v: number): string {
  const trim = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1_000_000_000) return `${trim(v / 1_000_000_000)} tỷ`;
  if (Math.abs(v) >= 1_000_000) return `${trim(v / 1_000_000)}tr`;
  return money(v);
}

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

  async firstRange(path: string): Promise<Range> {
    const find = () => this.items.find((c) => c.url.pathname.endsWith('/' + path));
    await expect.poll(() => Boolean(find()), { message: `Trang không gọi API ${path}`, timeout: 20_000 }).toBe(true);
    const { searchParams } = find()!.url;
    return { from: searchParams.get('startDate')!, to: searchParams.get('endDate')! };
  }

  /** Chờ trang gọi `path` (đúng khoảng ngày + tham số thêm) rồi trả body JSON */
  async wait(path: string, range?: Range, extra: Record<string, string> = {}): Promise<any> {
    const match = () =>
      this.items.findLast(
        (c) =>
          c.url.pathname.endsWith('/' + path) &&
          (!range || (c.url.searchParams.get('startDate') === range.from && c.url.searchParams.get('endDate') === range.to)) &&
          Object.entries(extra).every(([k, v]) => (c.url.searchParams.get(k) ?? '1') === v),
      );
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

  async shot(name: string, target?: Locator) {
    const file = this.info.outputPath(`${String(++this.shotNo).padStart(2, '0')}-${name.replace(/[^\p{L}\d]+/gu, '-')}.png`);
    // Chờ hiệu ứng vẽ biểu đồ xong cho ảnh rõ
    await this.page.waitForTimeout(400);
    if (target) await target.screenshot({ path: file });
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

async function openOverview(page: Page, api: ApiLog, report: Report) {
  await page.goto('/reports/revenue');
  await expect(page, 'Bị chuyển về trang đăng nhập — phiên hết hạn?').not.toHaveURL(/\/auth\//);
  await expect(page, 'Không có quyền xem Báo cáo doanh thu').not.toHaveURL(/\/errors\/|approval-required/);

  const def = await api.firstRange(SUMMARY);
  const range: Range = { from: ENV_FROM || def.from, to: ENV_TO || def.to };

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

  const summary = (await api.wait(SUMMARY, range))?.data;
  expect(summary, 'API tổng quan không trả dữ liệu').toBeTruthy();
  report.note(`Khoảng ngày: ${vnDate(range.from)} → ${vnDate(range.to)}`);
  report.note(`Tổng doanh thu: ${money(summary.totalRevenue ?? 0)}`);
  report.note('');
  return { range, summary, total: Number(summary.totalRevenue ?? 0) };
}

const tabsBox = (page: Page) => page.locator('app-revenue-tabs');

async function openTab(page: Page, label: string) {
  const box = tabsBox(page);
  const tab = box.getByRole('tab', { name: label, exact: true }).or(box.getByText(label, { exact: true })).first();
  await tab.click();
}

async function checkDetailTable(page: Page, api: ApiLog, report: Report, range: Range, total: number, reportPath: string, title: string) {
  await expect(page, `Không vào được trang "${title}" (bị chặn quyền / lỗi)`).not.toHaveURL(/\/errors\/|\/auth\//);
  await expect(page.getByText(title, { exact: true }).first(), `Không thấy tiêu đề "${title}"`).toBeVisible();

  let uiTotal = 0;
  let apiTotal = 0;
  let uiRows = 0;
  let totalRows = 0;
  for (let pageNo = 1; ; pageNo++) {
    const body = await api.wait(reportPath, range, { page: String(pageNo) });
    const items: any[] = body?.items ?? [];
    totalRows = Number(body?.total ?? items.length);
    apiTotal += sum(items, 'revenue');

    // chờ bảng hiện đủ số dòng API trả về
    const readColumn = () =>
      page.evaluate(() => {
        const heads = [...document.querySelectorAll('thead th')].map((th) => th.textContent!.trim().toLowerCase());
        const idx = heads.indexOf('doanh thu');
        if (idx < 0) return null;
        return [...document.querySelectorAll('tbody tr')]
          .filter((tr) => tr.children.length === heads.length || tr.children.length > idx + 1)
          .filter((tr) => !tr.querySelector('td[colspan]'))
          .map((tr) => tr.children[idx]?.textContent?.trim() ?? '');
      });
    await expect.poll(async () => (await readColumn())?.length, { message: `Bảng "${title}" trang ${pageNo} không hiện đủ ${items.length} dòng` }).toBe(items.length);
    const cells = (await readColumn()) ?? [];
    uiRows += cells.length;
    uiTotal += cells.reduce((s, t) => s + parseMoney(t), 0);
    // bảng có thanh cuộn riêng → mở hết chiều cao để ảnh thấy đủ mọi dòng (chỉ đổi hiển thị)
    await page.locator('table').last().evaluate((t) => {
      for (let el = t.parentElement; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).overflowY !== 'visible') el.style.maxHeight = 'none';
      }
    });
    await report.shot(`${title} — trang ${pageNo}`);

    const next = page.getByTitle('Trang sau');
    if (!(await next.isVisible())) break;
    await next.click();
  }

  report.count(`Số dòng trên bảng`, uiRows, totalRows, 'tổng số dòng');
  report.compare(`Cộng cột Doanh Thu (${uiRows} dòng)`, uiTotal, total);
  report.compare(`Cột Doanh Thu trên màn hình so với dữ liệu API`, uiTotal, apiTotal, 'API');
}

// ---------- kịch bản ----------

test.describe('Doanh thu', () => {
  test('1. Tổng quan — Tổng doanh thu & theo thời gian', async ({ page, api, report }) => {
    const { range, summary, total } = await openOverview(page, api, report);

    // Ô "Tổng doanh thu" hiện đúng số
    const card = page.locator('.dash-card').filter({ hasText: /Tổng doanh thu/i }).first();
    await expect(card.locator('.animate-pulse')).toHaveCount(0);
    const cardText = compactMoney(total);
    const cardOk = ((await card.textContent()) ?? '').includes(cardText);
    report.note(`${cardOk ? '✔' : '✘'} Ô "Tổng doanh thu" hiển thị: ${cardText}`);
    await expect.soft(card, 'Ô "Tổng doanh thu" hiện sai số').toContainText(cardText);
    await report.shot('Tổng quan');

    // Biểu đồ theo thời gian
    const chart = (await api.wait(CHART, range))?.data?.items ?? [];
    report.compare(`Theo thời gian — cộng ${chart.length} mốc`, sum(chart, 'revenue'), total);
    report.count('Đơn hàng theo thời gian', sum(chart, 'totalOrders'), Number(summary.totalOrders ?? 0), 'ô Đơn hàng');
    report.count('Đơn hàng huỷ theo thời gian', sum(chart, 'cancelledOrders'), Number(summary.cancelledOrders ?? 0), 'ô Đơn hàng huỷ');
    await report.shot('Doanh thu theo thời gian', page.locator('.dash-card').filter({ hasText: 'Doanh thu theo thời gian' }).first());
  });

  test('2. Phương thức thanh toán — biểu đồ tròn', async ({ page, api, report }) => {
    const { range, total } = await openOverview(page, api, report);
    const card = page.locator('.dash-card').filter({ hasText: 'Phương Thức Thanh Toán' }).first();

    const items: any[] = (await api.wait(PAYMENT, range))?.data ?? [];
    // số trên chú thích (mỗi PTTT 1 dòng: tên + số tiền)
    const legend = card.locator('strong');
    await expect.poll(() => legend.count(), { message: 'Chú thích PTTT không hiện đủ' }).toBe(items.length);
    const texts = await legend.allTextContents();
    for (const [i, it] of items.entries()) report.note(`   ${it.name}: ${texts[i]?.trim()}`);
    report.compare('Cộng các PTTT trên màn hình', texts.reduce((s, t) => s + parseMoney(t), 0), total);
    await report.shot('Phương thức thanh toán', card);
  });

  test('3. Phương thức thanh toán — Xem chi tiết', async ({ page, api, report }) => {
    const { range, total } = await openOverview(page, api, report);
    const card = page.locator('.dash-card').filter({ hasText: 'Phương Thức Thanh Toán' }).first();
    await card.getByRole('link', { name: /Xem Chi Tiết/i }).click();
    await checkDetailTable(page, api, report, range, total, 'reports/revenue/payment-method/report', 'Doanh Thu Theo Phương Thức Thanh Toán');
  });

  for (const [i, tab] of TABS.entries()) {
    const no = 4 + i * 2;

    test(`${no}. Tab ${tab.label}`, async ({ page, api, report }) => {
      const { range, total } = await openOverview(page, api, report);
      await openTab(page, tab.label);
      const items: any[] = (await api.wait(tab.chart, range))?.data?.items ?? [];
      report.compare(`Tab ${tab.label} — cộng ${items.length} dòng`, sum(items, 'revenue'), total);
      await tabsBox(page).scrollIntoViewIfNeeded();
      await report.shot(`Tab ${tab.label}`, tabsBox(page));
    });

    test(`${no + 1}. Tab ${tab.label} — Xem chi tiết`, async ({ page, api, report }) => {
      const { range, total } = await openOverview(page, api, report);
      await openTab(page, tab.label);
      await tabsBox(page).getByRole('link', { name: /Xem Chi Tiết/i }).click();
      await checkDetailTable(page, api, report, range, total, tab.detail.report, tab.detail.title);
    });
  }

  test(`${4 + TABS.length * 2}. Tab Sản Phẩm`, async ({ page, api, report }) => {
    await openOverview(page, api, report);
    await openTab(page, 'Sản Phẩm');
    report.note('Tab Sản Phẩm chưa có dữ liệu (đang làm) — chỉ chụp ảnh, chưa so số');
    await tabsBox(page).scrollIntoViewIfNeeded();
    await report.shot('Tab Sản Phẩm', tabsBox(page));
  });
});
