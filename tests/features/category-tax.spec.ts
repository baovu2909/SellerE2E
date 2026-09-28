import { Page, Response } from '@playwright/test';
import { expect, test } from '../shared-page';
import { Steps, firstPercent, waitIdle } from './helpers';

/**
 * Thiết lập thuế → VAT danh mục: đổi "Thuế suất / Tỷ lệ thuế mặc định" ở /configuration/tax-manager
 * rồi kiểm tra %VAT của MỌI danh mục có đổi theo không. Xong luôn trả thuế về mức cũ (kể cả khi lỗi giữa chừng).
 *
 * ⚠ Thay đổi dữ liệu thật trên toàn shop: theo code BE (VatManagerService.UpdateStoreVat), mỗi lần bấm "Cập nhật"
 *   - VAT của mọi danh mục bị ghi đè = thuế suất mới (trả thuế về thì danh mục cũng về theo)
 *   - VAT riêng của TỪNG SẢN PHẨM bị xoá (về trống → dùng theo danh mục) — cái này KHÔNG khôi phục được
 */

const isTax = (r: Response) => /vat-manager\/(types|configuration-vat)/.test(r.url()) && r.ok();
const isSearch = (r: Response) => r.url().includes('categories/search') && r.ok();

interface TaxState {
  vatType: number;
  eInvoiceUsable: boolean;
  vatPercent: number;
  options: number[]; // các mức thuế suất có thể chọn
}

async function openTax(page: Page): Promise<TaxState> {
  const res = page.waitForResponse(isTax, { timeout: 20_000 });
  await page.goto('/configuration/tax-manager');
  const body = await (await res).json();
  await waitIdle(page);
  await expect(page, 'Không vào được trang Thiết lập thuế (bị chặn quyền?)').not.toHaveURL(/\/errors\/|\/auth\//);
  const cur = body?.data?.currentTax ?? {};
  const type = (body?.data?.listTax ?? []).find((t: any) => t.type == cur.vatType);
  return {
    vatType: cur.vatType,
    eInvoiceUsable: Boolean(cur.eInvoiceUsable),
    vatPercent: Number(cur.vatPercent ?? 0),
    options: (type?.taxOptions ?? []).map((o: any) => Number(o.taxPercent)),
  };
}

/** Chọn thuế suất `pct` rồi bấm "Cập nhật" (đang ở trang Thiết lập thuế) */
async function setTax(page: Page, steps: Steps, pct: number) {
  await page.locator('amf-select').first().locator('button').first().click();
  await page.locator('button').filter({ hasText: new RegExp(`^\\s*${pct}%`) }).filter({ visible: true }).last().click();
  const saved = page.waitForResponse((r) => /vat-manager\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Cập nhật' }).click();
  const res = await saved;
  steps.check(res.ok(), `Lưu Thiết lập thuế ${pct}%`, `API trả ${res.status()}`);
  await expect(page.getByText('Thông tin thuế đã được cập nhật thành công').first(), 'Không thấy thông báo cập nhật thuế thành công').toBeVisible();
}

/** Mở Danh mục, kiểm tra MỌI danh mục (API) + cột %VAT (màn hình) = pct */
async function checkCategories(page: Page, steps: Steps, pct: number, label: string) {
  const res = page.waitForResponse(isSearch, { timeout: 20_000 });
  await page.goto('/categories');
  const body = await (await res).json();
  await waitIdle(page);
  const items: any[] = body?.items ?? body?.data?.items ?? [];
  const total = Number(body?.total ?? items.length);
  const wrong = items.filter((x) => Number(x.vatRate) !== pct);
  steps.check(
    items.length > 0 && wrong.length === 0,
    `${label}: VAT của ${items.length}/${total} danh mục = ${pct}%`,
    wrong.length
      ? `${wrong.length} danh mục khác: ${wrong.slice(0, 5).map((x) => `${x.subCategoryName ?? x.categoryNameLv2} (${x.vatRate}%)`).join(', ')}${wrong.length > 5 ? '…' : ''}`
      : items.length ? '' : 'không có danh mục nào để kiểm tra',
  );
  // cột %VAT trên màn hình
  const cells = await page.locator('tbody tr td:nth-child(3)').allTextContents();
  const badCells = cells.map((t) => t.trim()).filter((t) => t && firstPercent(t) !== pct);
  steps.check(badCells.length === 0, `${label}: cột %VAT trên màn hình đều ${pct}%`, badCells.length ? `có ô hiện: ${[...new Set(badCells)].join(', ')}` : `${cells.length} dòng`);
  await steps.shot(`Danh mục — ${label}`);
}

test.describe('Thiết lập thuế → VAT danh mục', () => {
  test('Đổi thuế suất mặc định → VAT mọi danh mục đổi theo, rồi trả về như cũ', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const steps = new Steps(page, testInfo);
    let original: TaxState | null = null;
    let changed = false;
    try {
      original = await openTax(page);
      steps.note(`Thuế hiện tại: ${original.vatPercent}% (${original.eInvoiceUsable ? 'có' : 'không'} xuất HĐĐT), các mức chọn được: ${original.options.join('%, ')}%`);
      await steps.shot('Thiết lập thuế — ban đầu');
      if (!original.eInvoiceUsable) {
        throw new Error('Đang chọn "Bán hàng không xuất hóa đơn điện tử" → VAT luôn 0%, không đổi thuế suất được. Chuyển sang "Bán hàng xuất hóa đơn điện tử" rồi chạy lại.');
      }
      const target = original.options.find((p) => p !== original!.vatPercent);
      if (target === undefined) throw new Error('Chỉ có 1 mức thuế suất để chọn — không đổi được để kiểm tra.');

      // Trước khi đổi: danh mục đang theo thuế hiện tại
      await checkCategories(page, steps, original.vatPercent, `Trước khi đổi (${original.vatPercent}%)`);

      // Đổi thuế → danh mục phải đổi theo
      steps.note(`Đổi thuế: ${original.vatPercent}% → ${target}%`);
      await openTax(page);
      await setTax(page, steps, target);
      changed = true;
      await steps.shot(`Thiết lập thuế — đã đổi ${target}%`);
      await checkCategories(page, steps, target, `Sau khi đổi thuế (${target}%)`);
    } finally {
      // Luôn trả thuế về mức cũ
      if (original && changed) {
        steps.note(`Trả thuế về ${original.vatPercent}%`);
        try {
          await openTax(page);
          await setTax(page, steps, original.vatPercent);
          await checkCategories(page, steps, original.vatPercent, `Sau khi trả về (${original.vatPercent}%)`);
        } catch (e: any) {
          steps.check(false, `TRẢ THUẾ VỀ ${original.vatPercent}% THẤT BẠI — vào Cấu hình chung → Thiết lập thuế chỉnh tay`, e.message.split('\n')[0]);
        }
      }
      await steps.flush();
    }
  });
});
