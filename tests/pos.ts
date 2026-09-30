import { Locator, Page, Response } from '@playwright/test';
import { expect } from './shared-page';

export interface PosProduct {
  productId: number;
  productName: string;
  price: number;
  inStock: number;
  isDependOnStock: boolean;
  categoryNameLevel1?: string;
  categoryNameLevel2?: string;
  categoryNameLevel3?: string;
}

export interface SoldOrder {
  orderId: number;
  orderCode: string;
  paid: number;
  bill: string;
  notice: string;
  revenue: number;
  lines: { productId: number; quantity: number; price: number }[];
}

const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function openPos(page: Page, storeName = ''): Promise<{ storeName: string; products: PosProduct[] }> {
  let products: PosProduct[] | null = null;
  const onRes = async (r: Response) => {
    if (!r.url().includes('/products/search-product')) return;
    const j = await r.json().catch(() => null);
    if (Array.isArray(j?.data)) products = j.data;
  };
  page.on('response', onRes);
  try {
    await page.goto('/sale-on-place');
    await expect(page, 'Không vào được màn hình bán tại quầy').not.toHaveURL(/\/errors\/|\/auth\//);
    const chosen = await chooseStoreWhenAsked(page, storeName, () => products !== null);
    expect(products, 'Không tải được danh sách sản phẩm bán tại quầy (chưa chọn được cửa hàng?)').not.toBeNull();
    return { storeName: chosen, products: products! };
  } finally {
    page.off('response', onRes);
  }
}

export async function chooseStoreWhenAsked(page: Page, storeName: string, done: () => boolean | Promise<boolean>, timeout = 40_000) {
  const search = page
    .locator('amf-input[label="Tìm kiếm cửa hàng"] input, input[placeholder*="Tìm kiếm cửa hàng"]')
    .filter({ visible: true })
    .first();
  const dialog = search.locator('xpath=ancestor::div[.//*[normalize-space()="Chọn Cửa Hàng"]][1]');
  let chosen = '';
  const deadline = Date.now() + timeout;
  while (!(await done()) && Date.now() < deadline) {
    if (await search.isVisible().catch(() => false)) {
      if (storeName) {
        await search.fill(storeName);
        const item = dialog.getByText(storeName, { exact: true }).first();
        await expect(item, `Không có cửa hàng "${storeName}" trong hộp Chọn Cửa Hàng`).toBeVisible();
        await item.click();
        chosen = storeName;
      } else {
        const def = dialog.getByText('Mặc định', { exact: true }).first();
        await expect(def, 'Chưa có cửa hàng mặc định để bán tại quầy — chọn cửa hàng ở trang điều khiển').toBeVisible();
        chosen = ((await def.locator('..').innerText()) ?? '').replace('Mặc định', '').trim();
        await def.click();
      }
      await expect(search, 'Chọn cửa hàng xong mà hộp "Chọn Cửa Hàng" không đóng').toBeHidden();
    }
    await page.waitForTimeout(300);
  }
  return chosen;
}

export function pickProduct(products: PosProduct[], name = ''): PosProduct | undefined {
  if (name) return products.find((p) => norm(p.productName) === norm(name));
  const count = new Map<string, number>();
  for (const p of products) count.set(norm(p.productName), (count.get(norm(p.productName)) ?? 0) + 1);
  return products
    .filter((p) => Number(p.price) > 0 && !(p.isDependOnStock && Number(p.inStock) <= 0) && count.get(norm(p.productName)) === 1)
    .sort((a, b) => Number(a.price) - Number(b.price))[0];
}

export async function findOnPos(page: Page, name: string, loaded: PosProduct[], id?: number): Promise<PosProduct> {
  const same = (p: PosProduct) => (id ? p.productId === id : norm(p.productName) === norm(name));
  const hit = loaded.find(same);
  if (hit) return hit;
  const res = page.waitForResponse((r) => r.url().includes('/products/search-product'), { timeout: 15_000 });
  await page.getByPlaceholder('Quét mã vạch hoặc tìm theo tên / mã / SKU').fill(name);
  const list: PosProduct[] = (await (await res).json().catch(() => null))?.data ?? [];
  const found = list.find(same);
  expect(found, `Không tìm thấy sản phẩm "${name}" ở màn hình bán tại quầy`).toBeTruthy();
  return found!;
}

export async function sell(
  page: Page,
  items: { product: PosProduct; qty: number }[],
  shot: (name: string, target?: Locator) => Promise<void>,
  opts: { allowNoInvoice?: boolean } = {},
): Promise<SoldOrder> {
  const cartCount = page.getByText(/Sản phẩm \(\s*\d+\s*\)/).first();
  await expect(cartCount).toBeVisible();
  expect(norm((await cartCount.textContent()) ?? ''), 'Giỏ hàng bán tại quầy đang có sẵn sản phẩm khác — xoá giỏ rồi chạy lại').toContain('(0)');

  for (const [i, { product, qty }] of items.entries()) {
    const cards = page.getByRole('heading', { name: product.productName, exact: true });
    if (!(await cards.first().isVisible())) {
      await page.getByPlaceholder('Quét mã vạch hoặc tìm theo tên / mã / SKU').fill(product.productName);
      await expect(cards.first(), `Không tìm thấy sản phẩm "${product.productName}" ở màn hình bán tại quầy`).toBeVisible();
    }

    const line = page.locator(`#product-${product.productId}`);
    const total = await cards.count();
    for (let n = 0; n < total && !(await line.isVisible()); n++) {
      await cards.nth(n).click();
      await expect(cartCount, `Bấm "${product.productName}" nhưng không vào giỏ`).toHaveText(new RegExp(`\\(\\s*${i + 1}\\s*\\)`));
      if (await line.isVisible()) break;
      await page.locator('[id^="product-"]').last().locator('button').first().click();
      await expect(cartCount).toHaveText(new RegExp(`\\(\\s*${i}\\s*\\)`));
    }
    await expect(line, `Giỏ không có đúng sản phẩm "${product.productName}" (id ${product.productId})`).toBeVisible();
    if (qty > 1) {
      const input = page.locator(`#product-${product.productId} input[type=number]`);
      await input.fill(String(qty));
      await input.press('Tab');
      await expect(input, `Không đổi được số lượng "${product.productName}" thành ${qty} (vượt tồn kho?)`).toHaveValue(String(qty));
    }
  }
  await shot('Bán tại quầy — giỏ hàng');

  await page.getByRole('button', { name: /^\s*Thanh toán\s*$/i }).last().click();
  await page.getByRole('button', { name: 'Tiền mặt' }).click();
  await shot('Bán tại quầy — xác nhận thanh toán');

  await page.evaluate(() => {
    (window as any).__printed = 0;
    window.print = () => { (window as any).__printed++; };
  });
  const saved = page.waitForResponse((r) => r.url().includes('/orders/save-wh') && r.request().method() === 'POST', { timeout: 30_000 });
  await page.getByRole('button', { name: /Hoàn tất thanh toán/i }).click();
  await page.getByRole('button', { name: 'Xác Nhận', exact: true }).click();
  const res = await saved;
  const body = await res.json().catch(() => null);
  expect(res.ok() && body?.isSuccess, `Tạo đơn thất bại: ${body?.message || res.status()}`).toBeTruthy();
  const orderCode = String(body.data.orderCode ?? '');

  const bill = page.locator('#receipt-print').filter({ hasText: 'Hóa Đơn Thanh Toán' }).filter({ hasText: orderCode });
  const finalizeError = page.getByText(/Lưu xuất kho thất bại!|Hóa đơn điện tử chưa được tạo\.|Không thể hoàn tất đơn hàng|Không thể tải thông tin đơn hàng để in/).first();
  await expect(bill.or(finalizeError), `Tạo đơn ${orderCode} xong nhưng không ra bill`).toBeAttached({ timeout: 30_000 });
  let notice = '';
  if (await finalizeError.isVisible().catch(() => false)) {
    notice = ((await finalizeError.locator('xpath=ancestor::div[1]').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    if (!(opts.allowNoInvoice && /Hóa đơn điện tử chưa được tạo/.test(notice))) throw new Error(`Tạo đơn ${orderCode} nhưng hoàn tất lỗi: ${notice}`);
    await expect(bill, `Tạo đơn ${orderCode} xong nhưng không ra bill`).toBeAttached({ timeout: 5_000 });
  }
  const billText = ((await bill.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  await page.emulateMedia({ media: 'print' });
  await shot(`Bill đơn ${orderCode}`, bill).catch(() => {});
  await page.emulateMedia({ media: 'screen' });
  await expect.poll(() => page.evaluate(() => (window as any).__printed), { message: `Ra bill đơn ${orderCode} nhưng không mở hộp in`, timeout: 10_000 }).toBeGreaterThan(0);
  if (notice) await page.getByRole('button', { name: 'Đóng', exact: true }).click().catch(() => {});
  await expect(cartCount, 'Thanh toán xong nhưng giỏ hàng chưa trống').toHaveText(/\(\s*0\s*\)/);
  await shot('Bán tại quầy — đã thanh toán');

  const sent: any[] = res.request().postDataJSON()?.products ?? [];
  return {
    orderId: body.data.orderId,
    orderCode,
    bill: billText,
    notice,
    paid: Number(body.data.totalAmount ?? 0),
    revenue: sent.reduce((s, p) => s + Number(p.quantity ?? 0) * Number(p.price ?? 0) - Number(p.promotionDiscountAmount ?? 0), 0),
    lines: sent.map((p) => ({ productId: Number(p.id), quantity: Number(p.quantity), price: Number(p.price) })),
  };
}
