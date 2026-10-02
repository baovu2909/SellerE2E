import { Locator, Page, Response } from '@playwright/test';
import { expect, test } from '../shared-page';
import { PosProduct, chooseStoreWhenAsked, findOnPos, openPos, pickProduct, sell } from '../pos';
import { cancelTestOrder, findInvoice, nextList, nextListFor, openDetail, result, rowOf, settle } from '../orders';
import { Steps, checkPagination, escapeRe, exactRe, norm, stateStore, waitIdle } from './helpers';

/**
 * Tab ĐƠN HÀNG (/orders) — có tạo dữ liệu thật.
 *
 *   1. Tạo đơn tại quầy   — /sale-on-place: cửa hàng + sản phẩm + số lượng (ô nhập trên trang điều khiển), tiền mặt
 *   2. Hoá đơn đầu ra      — /sales: có hoá đơn của đơn vừa tạo (mã đơn, số tiền) trước khi sang trang Đơn hàng
 *   3. Đơn trong danh sách — dòng đơn vừa tạo: mã, tổng tiền, PTTT, cửa hàng, trạng thái, nguồn
 *   4. Chi tiết đơn        — "Xem chi tiết": mã, cửa hàng, từng sản phẩm + số lượng, tổng cộng
 *   5. Bộ lọc              — mã đơn, khách hàng, cửa hàng, trạng thái thanh toán, khoảng ngày, lọc nâng cao; "Đặt lại"
 *   6. Phân trang
 *   7. Các nút             — Xuất File Excel, Gửi qua AMF Tax (đơn vừa tạo), Phát hành hoá đơn (1 đơn chưa phát hành),
 *                            tick chọn nhiều, In hóa đơn, Sao chép đơn hàng (→ Bán tại quầy, rồi xoá giỏ)
 *   8. Hủy đơn             — mọi đơn test (bước 1 + đơn phụ bước 7); HĐĐT chờ ký → báo "Không Thể Hủy" → hủy HĐĐT ở
 *                            Hoá đơn đầu ra (nhập lý do) → quay lại hủy đơn
 *
 * Ô nhập (env): ORDER_STORE (trống → cửa hàng mặc định), ORDER_ITEMS ([{"id","name","qty"}], trống → sản phẩm rẻ nhất còn hàng × 1)
 */

const STORE = (process.env.ORDER_STORE ?? '').trim();
const ITEMS: { id?: number; name: string; qty: number }[] = (() => {
  try {
    return JSON.parse(process.env.ORDER_ITEMS || '[]');
  } catch {
    return [];
  }
})();

interface Line { productId: number; name: string; quantity: number; price: number }
interface State {
  orderId: number;
  orderCode: string;
  paid: number;
  storeName: string;
  lines: Line[];
  /** đơn phụ tạo thêm khi test (vd thử "Phát hành hoá đơn") — bước cuối hủy hết */
  extra?: { orderId: number; orderCode: string }[];
}

const money = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;

/** "25.896,00 đ" / "25,896.00 đ" / "25.896đ" → 25896 */
function parseMoney(text: string): number {
  let s = (text ?? '').replace(/[^\d.,-]/g, '');
  const dec = s.match(/[.,](\d{1,2})$/);
  if (dec) s = s.slice(0, -dec[0].length);
  return Number(s.replace(/[.,]/g, '') + (dec ? `.${dec[1]}` : '')) || 0;
}

// ---------- danh sách ----------

async function openList(page: Page) {
  const res = nextList(page);
  await page.goto('/orders');
  await waitIdle(page);
  await expect(page, 'Không vào được trang Đơn hàng (bị chặn quyền / hết phiên?)').not.toHaveURL(/\/errors\/|\/auth\//);
  const r = await result(res);
  expect(Number.isNaN(r.total), 'Trang Đơn hàng không gọi được API danh sách').toBe(false);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  return r;
}

/** Chữ từng cột của 1 dòng theo tiêu đề bảng */
async function readRow(row: Locator) {
  return row.evaluate((tr) => {
    // tiêu đề có thể nằm ở 1 bảng riêng (bảng Đơn hàng) → tìm lên tới khung có thead
    let box: Element | null = tr.closest('table');
    while (box && !box.querySelector('thead th')) box = box.parentElement;
    const heads = [...(box?.querySelectorAll('thead th') ?? [])].map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim());
    const out: Record<string, string> = {};
    [...tr.children].forEach((td, i) => { if (heads[i]) out[heads[i]] = (td.textContent ?? '').replace(/\s+/g, ' ').trim(); });
    return out;
  });
}

/** Ô chọn của trang Đơn hàng (app-floating-dropdown): bấm ô → bấm đúng dòng lựa chọn */
async function pickSelect(page: Page, label: string, option: string) {
  const dd = page.locator(`app-floating-dropdown[label="${label}"]`).filter({ visible: true }).first();
  await settle(dd);
  await dd.locator('div').first().click();
  const li = dd.locator('li').filter({ hasText: exactRe(option) }).first();
  await expect(li, `Ô "${label}" không có lựa chọn "${option}"`).toBeVisible();
  await li.click();
}

// Thiết lập thuế (/configuration/tax-manager): đơn tại quầy tự phát hành HĐĐT khi chọn "Bán hàng xuất hóa đơn điện tử"
// (BE: OrderService.IsEInvoiceUsableAsync). Đổi xuất ↔ không xuất thì trang tự đổi thuế suất (0% / 5%) và bỏ tick giảm thuế
// → trước khi đổi ghi lại cấu hình gốc, trả về đúng từng ô.
const E_INVOICE_ON = 'Bán hàng xuất hóa đơn điện tử';
const E_INVOICE_OFF = 'Bán hàng không xuất hóa đơn điện tử';
const VAT_REDUCTION = 'Áp dụng giảm thuế theo Nghị quyết 204/2025/QH15';

interface TaxCfg { eInvoiceUsable: boolean; vatPercent: number; reduction: boolean | null; canTurnOff: boolean }

async function openTaxCfg(page: Page): Promise<TaxCfg> {
  const res = page.waitForResponse((r) => /vat-manager\/(types|configuration-vat)/.test(r.url()) && r.ok(), { timeout: 20_000 });
  await page.goto('/configuration/tax-manager');
  const cur = (await (await res).json())?.data?.currentTax ?? {};
  await waitIdle(page);
  await expect(page, 'Không vào được trang Thiết lập thuế (bị chặn quyền?)').not.toHaveURL(/\/errors\/|\/auth\//);
  const box = page.locator('label').filter({ hasText: VAT_REDUCTION }).locator('input[type=checkbox]');
  return {
    eInvoiceUsable: Boolean(cur.eInvoiceUsable),
    vatPercent: Number(cur.vatPercent ?? 0),
    reduction: (await box.count()) ? await box.isChecked() : null,
    canTurnOff: await page.locator('label').filter({ hasText: E_INVOICE_OFF }).isVisible(),
  };
}

async function saveTax(page: Page, steps: Steps, label: string) {
  const saved = page.waitForResponse((r) => /vat-manager\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Cập nhật' }).click();
  const res = await saved;
  steps.check(res.ok(), `Thiết lập thuế: ${label}`, `API ${res.status()}`);
  await steps.shot(`Thiết lập thuế — ${label}`);
}

async function turnEInvoiceOff(page: Page, steps: Steps) {
  await openTaxCfg(page);
  await page.locator('label').filter({ hasText: E_INVOICE_OFF }).locator('input[type=radio]').check();
  await saveTax(page, steps, `chọn "${E_INVOICE_OFF}"`);
}

/** Trả Thiết lập thuế về đúng cấu hình gốc rồi đọc lại để chắc chắn */
async function restoreTax(page: Page, steps: Steps, orig: TaxCfg) {
  await openTaxCfg(page);
  await page.locator('label').filter({ hasText: orig.eInvoiceUsable ? E_INVOICE_ON : E_INVOICE_OFF }).locator('input[type=radio]').check();
  if (orig.eInvoiceUsable) {
    await page.locator('amf-select').first().locator('button').first().click();
    await page.locator('button').filter({ hasText: new RegExp(`^\\s*${escapeRe(String(orig.vatPercent))}%`) }).filter({ visible: true }).last().click();
    if (orig.reduction !== null) await page.locator('label').filter({ hasText: VAT_REDUCTION }).locator('input[type=checkbox]').setChecked(orig.reduction);
  }
  await saveTax(page, steps, `trả về như cũ (${orig.eInvoiceUsable ? E_INVOICE_ON : E_INVOICE_OFF}, ${orig.vatPercent}%${orig.reduction ? ', có giảm thuế' : ''})`);
  const now = await openTaxCfg(page);
  const same = now.eInvoiceUsable === orig.eInvoiceUsable && now.vatPercent === orig.vatPercent && (orig.reduction === null || now.reduction === orig.reduction);
  steps.check(same, 'Thiết lập thuế đã về đúng cấu hình gốc', `đang: ${now.eInvoiceUsable ? 'xuất' : 'không xuất'} HĐĐT, ${now.vatPercent}%, giảm thuế ${now.reduction ? 'có' : 'không'}`);
}

async function applyAdvanced(page: Page, label: string, option: string) {
  const title = page.getByText(/Bộ\s+Lọc\s+Nâng\s+Cao/);
  if (!(await title.isVisible())) await page.getByTitle('Bộ lọc nâng cao').click();
  await expect(title).toBeVisible();
  await pickSelect(page, label, option);
  await page.getByRole('button', { name: 'Áp Dụng', exact: true }).click();
  if (await title.isVisible()) await title.locator('xpath=ancestor::div[1]').getByRole('button').first().click();
  await expect(title, 'Không đóng được khung "Bộ Lọc Nâng Cao"').toBeHidden();
}

test.describe('Đơn hàng', () => {
  test('1. Tạo đơn tại quầy', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'order');
    st.write({});
    try {
      const pos = await openPos(page, STORE);
      const storeName = pos.storeName || STORE;
      steps.note(`Cửa hàng: ${storeName || '(đã chọn sẵn)'}`);

      const items: { product: PosProduct; qty: number }[] = [];
      if (ITEMS.length) for (const it of ITEMS) items.push({ product: await findOnPos(page, it.name, pos.products, it.id), qty: it.qty });
      else {
        const p = pickProduct(pos.products);
        expect(p, 'Cửa hàng không có sản phẩm nào còn hàng để tạo đơn').toBeTruthy();
        items.push({ product: p!, qty: 1 });
      }
      for (const { product, qty } of items) steps.note(`   ${product.productName} × ${qty} — ${money(Number(product.price))}`);

      const order = await sell(page, items, (name, target) => steps.shot(name, target));
      steps.check(true, `Tạo đơn ${order.orderCode} (id ${order.orderId})`, `khách trả ${money(order.paid)}`);
      steps.check(true, `Ra bill "Hóa Đơn Thanh Toán" — Mã đơn hàng: ${order.orderCode}`);
      for (const { product } of items) steps.check(norm(order.bill).includes(norm(product.productName)), `Bill có "${product.productName}"`);
      const billTotal = parseMoney(order.bill.match(/Tổng Cộng\s*([\d.,]+)/i)?.[1] ?? '');
      steps.check(billTotal === order.paid, `Bill: "Tổng Cộng" = ${money(order.paid)}`, money(billTotal));
      for (const { product, qty } of items) {
        const sent = order.lines.find((l) => l.productId === product.productId);
        steps.check(sent?.quantity === qty, `Đơn gửi đi có "${product.productName}" × ${qty}`, sent ? `× ${sent.quantity}` : 'không có trong đơn');
      }
      st.write({
        orderId: order.orderId,
        orderCode: order.orderCode,
        paid: order.paid,
        storeName,
        lines: order.lines.map((l) => ({ ...l, name: items.find((i) => i.product.productId === l.productId)?.product.productName ?? '' })),
      });
    } finally {
      await steps.flush();
    }
  });

  test('2. Hoá đơn đầu ra có đơn vừa tạo', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'order').read();
    test.skip(!st.orderCode, 'Bước 1 chưa tạo được đơn');
    try {
      const found = await findInvoice(page, st.orderCode!);
      steps.check(Boolean(found), `Hoá đơn đầu ra có hoá đơn của đơn ${st.orderCode}`, found ? `ký hiệu ${found.khieu}, ${found.tthai}` : 'không thấy ở trang 1 sau ~60 giây');
      if (!found) return;
      steps.check(Number(found.tgtttbso) === st.paid, `Hoá đơn: tổng tiền = ${money(st.paid!)}`, money(found.tgtttbso));
      steps.check(norm(found.htttoan) === 'tiền mặt', 'Hoá đơn: hình thức thanh toán = Tiền mặt', found.htttoan);
      const row = rowOf(page, st.orderCode!);
      await expect(row, `Bảng Hoá đơn đầu ra không hiện dòng đơn ${st.orderCode}`).toBeVisible();
      const cells = await readRow(row);
      steps.check(parseMoney(cells['Doanh thu sau thuế'] ?? '') === st.paid, 'Dòng hoá đơn: "Doanh thu sau thuế" khớp đơn', cells['Doanh thu sau thuế']);
      steps.note(`   Trạng thái HĐ: ${cells['Trạng thái HĐ']} — Trạng thái CQT: ${cells['Trạng thái CQT']}`);
      await settle(row);
      await steps.shot('Hoá đơn đầu ra');
    } finally {
      await steps.flush();
    }
  });

  test('3. Đơn vừa tạo trong danh sách', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'order').read();
    test.skip(!st.orderCode, 'Bước 1 chưa tạo được đơn');
    try {
      const list = await openList(page);
      steps.note(`Danh sách: ${list.total} đơn`);
      const item = list.items.find((x) => x.id === st.orderId);
      steps.check(list.items[0]?.id === st.orderId, `Đơn ${st.orderCode} đứng đầu danh sách (mới nhất)`, item ? '' : 'không có ở trang 1');
      const row = rowOf(page, st.orderCode!);
      await expect(row, `Không thấy dòng đơn ${st.orderCode}`).toBeVisible();
      const cells = await readRow(row);
      steps.check(parseMoney(cells['Tổng Tiền']) === st.paid, `Tổng Tiền = ${money(st.paid!)}`, cells['Tổng Tiền']);
      steps.check(norm(cells['PT Thanh Toán']) === 'tiền mặt', 'PT Thanh Toán = Tiền mặt', cells['PT Thanh Toán']);
      if (st.storeName) steps.check(norm(cells['Cửa Hàng']) === norm(st.storeName), `Cửa Hàng = ${st.storeName}`, cells['Cửa Hàng']);
      steps.check(norm(cells['Trạng Thái Thanh Toán']) === 'đã thanh toán', 'Trạng Thái Thanh Toán = Đã Thanh Toán', cells['Trạng Thái Thanh Toán']);
      steps.check(norm(cells['Nguồn Đơn Hàng']) === 'bán hàng tại quầy', 'Nguồn Đơn Hàng = Bán Hàng Tại Quầy', cells['Nguồn Đơn Hàng']);
      steps.note(`   Trạng Thái Phát Hành: ${cells['Trạng Thái Phát Hành']}`);
      if (item) steps.check(Number(item.totalMustPay) === st.paid, 'API danh sách: tổng tiền khớp đơn vừa tạo', `${money(item.totalMustPay)}`);
      await row.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await steps.shot('Đơn vừa tạo trong danh sách');
    } finally {
      await steps.flush();
    }
  });

  test('4. Chi tiết đơn', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'order').read();
    test.skip(!st.orderCode, 'Bước 1 chưa tạo được đơn');
    try {
      await openList(page);
      const detailRes = page.waitForResponse((r) => r.url().includes(`/orders/${st.orderId}/offline`) && r.request().method() === 'GET', { timeout: 20_000 });
      await rowOf(page, st.orderCode!).locator('amf-tooltip[text="Xem chi tiết"] button').click();
      await expect(page, 'Không mở được trang chi tiết').toHaveURL(new RegExp(`/orders/order-detail-offline/${st.orderId}`));
      const detail = (await (await detailRes).json())?.data;

      await expect(page.getByText(`Đơn hàng #${st.orderCode}`)).toBeVisible();
      steps.check(true, `Tiêu đề "Đơn hàng #${st.orderCode}"`);
      if (st.storeName) steps.check(await page.getByText(`Cửa hàng: ${st.storeName}`).isVisible(), `Hiện "Cửa hàng: ${st.storeName}"`);
      const count = page.getByText(/Sản phẩm:\s*\d+/).first();
      steps.check(norm((await count.textContent()) ?? '').endsWith(`${st.lines!.length}`), `"Sản phẩm: ${st.lines!.length}"`, (await count.textContent())?.trim());

      for (const l of st.lines!) {
        const api = (detail?.productOrderDetails ?? []).find((p: any) => p.productId === l.productId);
        steps.check(api?.quantity === l.quantity && Number(api?.price) === l.price, `API chi tiết: "${l.name}" × ${l.quantity}, giá ${money(l.price)}`, api ? `× ${api.quantity}, ${money(api.price)}` : 'không có');
        const row = page.locator('table tbody tr').filter({ hasText: l.name }).first();
        const text = (await row.textContent().catch(() => '')) ?? '';
        steps.check(Boolean(text) && new RegExp(`(^|\\D)${l.quantity}(\\D|$)`).test(text), `Màn hình có dòng "${l.name}" × ${l.quantity}`, text.replace(/\s+/g, ' ').slice(0, 120));
      }
      const total = page.getByText('Tổng cộng', { exact: true }).locator('xpath=..');
      const shown = parseMoney(((await total.textContent()) ?? '').replace('Tổng cộng', ''));
      steps.check(shown === st.paid, `"Tổng cộng" = ${money(st.paid!)}`, money(shown));
      steps.check(Number(detail?.totalAmount) === st.paid, 'API chi tiết: totalAmount khớp', money(detail?.totalAmount));
      await steps.shot('Chi tiết đơn');
    } finally {
      await steps.flush();
    }
  });

  test('5. Bộ lọc', async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'order').read();
    try {
      const full = await openList(page);
      steps.note(`Không lọc: ${full.total} đơn`);
      const rows = page.locator('tbody tr');
      const reset = async () => {
        const res = nextList(page);
        const btn = page.getByRole('button', { name: 'Đặt lại', exact: true }).first();
        if (await btn.isDisabled()) return;
        await btn.click();
        const back = await result(res);
        steps.check(back.total === full.total, '"Đặt lại" → về đủ danh sách', `${back.total} / ${full.total} đơn`);
      };

      /** Chạy 1 bộ lọc: act() thao tác, match(item) = đơn đúng điều kiện */
      const tryFilter = async (label: string, act: () => Promise<void>, match: (x: any) => boolean, want?: (req: any) => boolean) => {
        const res = nextList(page, (req) => !want || want(req.searchParams ?? {}));
        await act();
        const r = await result(res);
        await waitIdle(page);
        if (Number.isNaN(r.total)) return steps.check(false, `Lọc ${label}`, 'trang không gọi lại API');
        const wrong = r.items.filter((x) => !match(x));
        if (!r.items.length) steps.warn(`Lọc ${label}: 0 đơn`, 'không có dữ liệu phù hợp để kiểm tra');
        else steps.check(wrong.length === 0, `Lọc ${label}: ${r.total} đơn đều đúng điều kiện`, wrong.slice(0, 3).map((x) => x.orderCode).join(', '));
        if (r.items.length) await expect.poll(() => rows.count(), { timeout: 10_000 }).toBe(r.items.length).catch(() => {});
        const uiRows = r.items.length ? await rows.count() : 0;
        if (r.items.length) steps.check(uiRows === r.items.length, `Lọc ${label}: bảng hiện đủ ${r.items.length} dòng`, `${uiRows}`);
        await steps.shot(`Lọc ${label}`);
        return r;
      };

      // Mã đơn hàng
      if (st.orderCode) {
        const code = page.locator('amf-input[label="Mã đơn hàng"] input');
        const r = await tryFilter(`mã đơn "${st.orderCode}"`, () => code.fill(st.orderCode!), (x) => x.orderCode.includes(st.orderCode), (p) => p.orderCode === st.orderCode);
        steps.check(r?.items.some((x) => x.id === st.orderId) ?? false, `Lọc mã đơn: ra đúng đơn ${st.orderCode}`);
        await reset();
      }

      // Tên khách hàng (lấy tên ở dòng đầu)
      const customer = String(full.items[0]?.saleFullName ?? '').trim();
      if (customer) {
        const box = page.locator('amf-input[label="Tên khách hàng"] input');
        await tryFilter(`khách hàng "${customer}"`, () => box.fill(customer), (x) => norm(x.saleFullName).includes(norm(customer)), (p) => p.customerName === customer);
        await reset();
      }

      // Cửa hàng
      const store = st.storeName || String(full.items[0]?.storeName ?? '');
      if (store) {
        await tryFilter(`cửa hàng "${store}"`, () => pickSelect(page, 'Cửa hàng', store), (x) => norm(x.storeName) === norm(store), (p) => p.storeId != null);
        await reset();
      }

      // Trạng thái thanh toán
      for (const opt of ['Đã thanh toán', 'Chưa thanh toán']) {
        await tryFilter(`"${opt}"`, () => pickSelect(page, 'Trạng thái thanh toán', opt), (x) => norm(x.paymentStatusName) === norm(opt), (p) => p.paymentStatus != null);
        await reset();
      }

      // Khoảng ngày: hôm nay
      const today = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
      const inputs = page.locator('amf-daterange input');
      if ((await inputs.count()) >= 2) {
        const r = await tryFilter(
          `ngày ${today}`,
          async () => {
            for (const i of [0, 1]) {
              await inputs.nth(i).click();
              await inputs.nth(i).press('Control+A');
              await inputs.nth(i).pressSequentially(today.replace(/\//g, ''));
            }
            await page.keyboard.press('Enter');
            await page.keyboard.press('Escape');
          },
          (x) => new Date(x.transDate).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) === today,
          (p) => p.transDate != null,
        );
        if (st.orderId && r) steps.check(r.items.some((x) => x.id === st.orderId) || r.total > r.items.length, `Lọc ngày hôm nay có đơn vừa tạo`);
        await reset();
      } else steps.warn('Không thấy ô khoảng ngày');

      // Lọc nâng cao
      const advanced = async (select: string, option: string, match: (x: any) => boolean, want: (p: any) => boolean) => {
        await tryFilter(
          `nâng cao "${select}" = "${option}"`,
          () => applyAdvanced(page, select, option),
          match,
          want,
        );
        await reset();
      };
      await advanced('Nguồn đơn hàng', 'Bán Hàng Tại Quầy', (x) => x.orderSource === 1, (p) => p.orderSource != null);
      await advanced('PT thanh toán', 'Tiền mặt', (x) => norm(x.paymentMethodNameVI) === 'tiền mặt', (p) => p.paymentMethodId !== -1 && p.paymentMethodId != null);
      await advanced('Trạng Thái Phát Hành', 'Đã phát hành HĐĐT', (x) => x.isInvoice === true, (p) => p.isInvoice != null);
      await advanced('Trạng Thái Phát Hành', 'Chưa phát hành HĐĐT', (x) => x.isInvoice === false, (p) => p.isInvoice != null);
    } finally {
      await steps.flush();
    }
  });

  test('6. Phân trang', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      const first = await openList(page);
      await checkPagination(page, steps, {
        total: first.total,
        firstPage: first.items,
        idOf: (x) => x.id,
        pageSize: 20,
        nextPage: async () => {
          const res = nextList(page, (req) => Number(req.page) === 2);
          await page.getByTitle('Trang sau').click();
          return (await result(res)).items;
        },
      });
    } finally {
      await steps.flush();
    }
  });

  test('7. Các nút', async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'order').read();
    try {
      const full = await openList(page);

      // Xuất File Excel
      const download = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
      await page.getByRole('button', { name: /Xuất File Excel/ }).click();
      const file = await download;
      const name = file?.suggestedFilename() ?? '';
      const path = file ? await file.path().catch(() => null) : null;
      steps.check(Boolean(file) && /\.xlsx?$/i.test(name), 'Xuất File Excel → tải được file Excel', name || 'không tải được file');
      if (path) await testInfo.attach(`Excel ${name}`, { path });

      if (!st.orderCode) steps.warn('Chưa có đơn vừa tạo (bước 1 chưa chạy / lỗi)', 'bỏ Gửi AMF Tax, tick chọn, In, Sao chép — chạy cả bộ test Đơn hàng');
      if (st.orderCode) {
        const row = rowOf(page, st.orderCode);
        await settle(row);

        // Gửi qua AMF Tax — bấm thật trên đơn vừa tạo
        const taxBtn = row.locator('amf-tooltip[text="Gửi qua AMF Tax"] button');
        if (await taxBtn.count()) {
          const res = page.waitForResponse((r) => /Send-order-to-tax/i.test(r.url()), { timeout: 30_000 }).catch(() => null);
          await taxBtn.click();
          const r = await res;
          const body = await r?.json().catch(() => null);
          const ok = Boolean(r?.ok()) && (body?.isSuccess ?? body?.type !== 'error');
          const toast = await page.getByText(/Gửi qua AMF Tax (thành công|thất bại)/).first().textContent({ timeout: 10_000 }).catch(() => '');
          steps.check(ok, `Gửi qua AMF Tax đơn ${st.orderCode}`, `${r ? `API ${r.status()}` : 'không gọi API'}${body?.message ? `: ${body.message}` : ''}${toast ? ` — "${toast.trim()}"` : ''}`);
          await steps.shot('Gửi qua AMF Tax');
        } else steps.warn('Không thấy nút "Gửi qua AMF Tax" trên dòng đơn', 'tài khoản không có quyền?');

        // Đơn đã phát hành thì nút Phát hành bị khoá
        const item = full.items.find((x) => x.id === st.orderId);
        const invoiceBtn = row.locator('amf-tooltip:not([text="Xem chi tiết"]):not([text="Gửi qua AMF Tax"]) button').last();
        if (item?.isInvoice && (await invoiceBtn.count())) steps.check(await invoiceBtn.isDisabled(), 'Đơn đã phát hành HĐĐT → nút "Phát hành hoá đơn" bị khoá');

        // Tick chọn → hiện thanh thao tác hàng loạt, bỏ tick
        // amf-checkbox: .chk-box mới là phần có kích thước để bấm
        const tick = row.locator('amf-checkbox .chk-box').first();
        if (await tick.count()) {
          await tick.click({ timeout: 8_000 });
          const bar = page.getByRole('button', { name: /Gửi Qua AMF Tax/ });
          steps.check(await bar.isVisible({ timeout: 5_000 }).catch(() => false), 'Tick chọn đơn → hiện nút "Gửi Qua AMF Tax" hàng loạt');
          await steps.shot('Chọn nhiều đơn');
          await tick.click({ timeout: 8_000 });
        } else steps.warn('Dòng đơn không có ô tick', 'tài khoản không có quyền phát hành hoá đơn?');
      }

      // Phát hành hoá đơn: đơn tạo khi "Bán hàng xuất hóa đơn điện tử" tự phát hành → chuyển sang "không xuất",
      // tạo 1 đơn mới (chưa có HĐĐT) → trả Thiết lập thuế về như cũ → bấm "Phát hành hoá đơn" trên chính đơn đó
      const orig = st.lines?.length ? await openTaxCfg(page) : null;
      if (!st.lines?.length) steps.warn('Chưa có sản phẩm của đơn bước 1', 'không tạo được đơn chưa phát hành để thử "Phát hành hoá đơn"');
      else if (!orig!.eInvoiceUsable) steps.warn(`Thiết lập thuế đang "${E_INVOICE_OFF}"`, 'shop không phát hành HĐĐT → bỏ thử "Phát hành hoá đơn"');
      else if (!orig!.canTurnOff) steps.warn(`Thiết lập thuế không có lựa chọn "${E_INVOICE_OFF}" (cửa hàng doanh nghiệp)`, 'không tạo được đơn chưa phát hành để thử "Phát hành hoá đơn"');
      else {
        let restored = false;
        try {
          steps.note(`Thiết lập thuế gốc: ${E_INVOICE_ON}, ${orig!.vatPercent}%, giảm thuế ${orig!.reduction ? 'có' : 'không'}`);
          await turnEInvoiceOff(page, steps);
          const pos = await openPos(page, st.storeName ?? '');
          const product = await findOnPos(page, st.lines[0].name, pos.products, st.lines[0].productId);
          const order = await sell(page, [{ product, qty: 1 }], (name, target) => steps.shot(name, target), { allowNoInvoice: true });
          steps.check(true, `Tạo đơn ${order.orderCode} khi "${E_INVOICE_OFF}" — ra bill`, order.notice ? `thông báo: "${order.notice}"` : '');
          const store = stateStore<State>(testInfo, 'order');
          const saved = store.read();
          store.write({ ...saved, extra: [...(saved.extra ?? []), { orderId: order.orderId, orderCode: order.orderCode }] });
          await restoreTax(page, steps, orig!);
          restored = true;

          {
            const before = (await result(nextListFor(page, order.orderCode))).items.find((x) => x.orderCode === order.orderCode);
            steps.check(before?.isInvoice === false, `Đơn ${order.orderCode} chưa phát hành HĐĐT`, before ? `isInvoice=${before.isInvoice}` : 'không thấy trong danh sách');
            const row = rowOf(page, order.orderCode);
            await settle(row);
            const btn = row.locator('amf-tooltip:not([text="Xem chi tiết"]):not([text="Gửi qua AMF Tax"]) button').last();
            steps.check(await btn.isEnabled().catch(() => false), 'Nút "Phát hành hoá đơn" bấm được');
            if (await btn.isEnabled().catch(() => false)) {
              const call = page.waitForResponse((x) => x.request().method() === 'POST' && /\/orders\/save-invoice/i.test(x.url()), { timeout: 30_000 }).catch(() => null);
              await btn.click();
              const c = await call;
              const body = await c?.json().catch(() => null);
              const now = (await result(nextListFor(page, order.orderCode))).items.find((x) => x.orderCode === order.orderCode);
              steps.check(Boolean(now?.isInvoice), `Phát hành hoá đơn đơn ${order.orderCode}`, `${c ? `API ${c.status()}${body?.message ? `: ${body.message}` : ''}` : 'không thấy API phát hành'}; sau đó ${now?.isInvoice ? 'đã' : 'CHƯA'} phát hành`);
              await steps.shot('Phát hành hoá đơn');
              const inv = await findInvoice(page, order.orderCode);
              steps.check(Boolean(inv), `Hoá đơn đầu ra có hoá đơn của đơn ${order.orderCode} sau khi phát hành`, inv ? `ký hiệu ${inv.khieu}, ${inv.tthai}` : 'không thấy');
            }
          }
        } finally {
          if (!restored) await restoreTax(page, steps, orig!);
        }
      }

      if (!st.orderCode) return;

      // Chi tiết: In hóa đơn
      await openList(page);
      await rowOf(page, st.orderCode).locator('amf-tooltip[text="Xem chi tiết"] button').click();
      await expect(page).toHaveURL(new RegExp(`/orders/order-detail-offline/${st.orderId}`));
      await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
      const popup = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
      await page.getByRole('button', { name: /In hóa đơn/ }).click();
      const printed = await Promise.race([
        expect.poll(() => page.evaluate(() => (window as any).__printed), { timeout: 15_000 }).toBeGreaterThan(0).then(() => 'hộp in').catch(() => null),
        popup.then((p) => (p ? 'cửa sổ mới' : null)),
      ]);
      steps.check(Boolean(printed), 'In hóa đơn → mở bản in', printed ?? 'không mở hộp in / cửa sổ in');
      await steps.shot('In hóa đơn');
      if (printed === 'cửa sổ mới') await (await popup)?.close();

      // Sao chép đơn hàng → Bán tại quầy có sẵn đúng sản phẩm, rồi xoá giỏ
      await page.getByRole('button', { name: /Sao chép đơn hàng/ }).click();
      await expect(page, 'Sao chép không chuyển sang Bán tại quầy').toHaveURL(/sale-on-place/);
      const cartCount = page.getByText(/Sản phẩm \(\s*\d+\s*\)/).first();
      const cartFull = new RegExp(`\\(\\s*${st.lines!.length}\\s*\\)`);
      await chooseStoreWhenAsked(page, st.storeName ?? '', async () => cartFull.test((await cartCount.textContent().catch(() => '')) ?? ''), 20_000);
      for (const l of st.lines!) {
        const qty = page.locator(`#product-${l.productId} input[type=number]`);
        const got = (await qty.inputValue().catch(() => '')) || '';
        steps.check(got === String(l.quantity), `Sao chép: giỏ có "${l.name}" × ${l.quantity}`, got ? `× ${got}` : 'không có trong giỏ');
      }
      await steps.shot('Sao chép đơn hàng');
      // xoá giỏ: nhập số lượng 0 → trang tự bỏ dòng (nút × có lúc không bấm được)
      for (const l of st.lines!) {
        const qty = page.locator(`#product-${l.productId} input[type=number]`);
        if (!(await qty.count())) continue;
        await qty.fill('0', { timeout: 5_000 }).catch(() => {});
        await qty.press('Tab', { timeout: 5_000 }).catch(() => {});
      }
      await expect(cartCount).toHaveText(/\(\s*0\s*\)/, { timeout: 5_000 }).catch(() => {});
      steps.check(/\(\s*0\s*\)/.test((await cartCount.textContent()) ?? ''), 'Xoá giỏ sau khi sao chép (không để lại đơn nháp)', (await cartCount.textContent())?.trim());
    } finally {
      await steps.flush();
    }
  });

  test('8. Hủy đơn', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'order').read();
    test.skip(!st.orderCode, 'Bước 1 chưa tạo được đơn');
    try {
      // hủy mọi đơn test đã tạo (đơn bước 1 + đơn phụ bước 7) để không đơn test nào còn tồn tại
      for (const o of [{ orderId: st.orderId!, orderCode: st.orderCode! }, ...(st.extra ?? [])]) await cancelTestOrder(page, steps, o);
    } finally {
      await steps.flush();
    }
  });
});
