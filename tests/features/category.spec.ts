import { Page, Response, TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { expect, test } from '../shared-page';
import { Steps, firstPercent, waitIdle } from './helpers';

/**
 * Tab DANH MỤC (/categories) — TẠO → XEM → SỬA 1 danh mục cấp 3 (có tạo / sửa dữ liệu thật).
 *
 *   Cấp 1 / Cấp 2 : CATEGORY_LV1 / CATEGORY_LV2 (ô nhập trên trang điều khiển), trống → "Thiết bị điện tử" / "Bộ phận máy tính".
 *                   Phải là danh mục có sẵn (không phân biệt hoa thường), cấp 2 nằm trong cấp 1.
 *   Cấp 3         : CATEGORY_NAME, trống → "Danh mục test" (đã có trong cấp 2 thì tự thành "Danh mục test 2", 3…)
 *   Sửa           : đổi tên cấp 3 thành "<tên> (sửa)" (đã có thì "(sửa 2)"…), KHÔNG sửa VAT
 *   VAT           : không chọn / sửa — kiểm tra VAT mặc định của danh mục = thuế suất mặc định trong Thiết lập thuế
 *
 * Các test chạy theo thứ tự trên cùng 1 cửa sổ (tạo → xem → sửa). Tên dùng ở bước Tạo được ghi ra file
 * trong thư mục kết quả để bước Xem / Sửa dùng lại.
 */

const IN_LV1 = (process.env.CATEGORY_LV1 || 'Thiết bị điện tử').trim();
const IN_LV2 = (process.env.CATEGORY_LV2 || 'Bộ phận máy tính').trim();
const IN_NAME = (process.env.CATEGORY_NAME || '').trim();
const DEFAULT_NAME = 'Danh mục test';

const norm = (s: string) => (s ?? '').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** khớp đúng cả chữ (bỏ khoảng trắng 2 đầu, không phân biệt hoa thường) */
const exactRe = (s: string) => new RegExp(`^\\s*${escapeRe(s)}\\s*$`, 'i');

interface Names {
  lv1: string; // tên đúng như trong hệ thống
  lv2: string;
  lv3: string[]; // các danh mục cấp 3 đang có trong cấp 2
}

/** Tìm cấp 1 / cấp 2 trong cây danh mục (API categories-tree) */
function resolveNames(tree: any[]): Names {
  const c1 = tree.find((c) => norm(c.name) === norm(IN_LV1));
  if (!c1) throw new Error(`Không có danh mục cấp 1 "${IN_LV1}". Có: ${tree.map((c) => c.name).join(', ')}`);
  const c2 = (c1.children ?? []).find((c: any) => norm(c.name) === norm(IN_LV2));
  if (!c2) throw new Error(`"${c1.name}" không có danh mục cấp 2 "${IN_LV2}". Có: ${(c1.children ?? []).map((c: any) => c.name).join(', ')}`);
  return { lv1: c1.name, lv2: c2.name, lv3: (c2.children ?? []).map((c: any) => c.name) };
}

/** Tên chưa có trong cấp 2: base, base 2, base 3… */
const freeName = (base: string, taken: string[], sep = ' ') => {
  const set = new Set(taken.map(norm));
  if (!set.has(norm(base))) return base;
  for (let i = 2; ; i++) if (!set.has(norm(`${base}${sep}${i}`))) return `${base}${sep}${i}`;
};

/** Tên cấp 3 bước Tạo đã dùng → bước Xem / Sửa đọc lại */
const nameFile = (info: TestInfo) => path.join(info.project.outputDir, 'category-name.txt');
const savedName = (info: TestInfo) => {
  try { return fs.readFileSync(nameFile(info), 'utf8').trim() || null; } catch { return null; }
};

const PAGE_SIZE = 20; // FE: DefaultPageSize — hơn 20 dòng mới có trang 2

const isSearch = (r: Response) => r.url().includes('categories/search') && r.ok();
const searchBody = async (res: Promise<Response | null>) => {
  const body = await (await res)?.json().catch(() => null);
  return { items: (body?.items ?? body?.data?.items ?? []) as any[], total: Number(body?.total ?? body?.data?.total ?? NaN) };
};

/**
 * Mở trang danh mục. Trả về VAT mặc định theo Thiết lập thuế (có xuất HĐĐT → vatPercent, không → 0)
 * và tổng số danh mục (chưa lọc).
 */
async function openCategories(page: Page, steps: Steps) {
  const taxRes = page.waitForResponse((r) => /vat-manager\/(types|configuration-vat)/.test(r.url()) && r.ok(), { timeout: 20_000 }).catch(() => null);
  const listRes = page.waitForResponse(isSearch, { timeout: 20_000 }).catch(() => null);
  const treeRes = page.waitForResponse((r) => r.url().includes('categories/categories-tree') && r.ok(), { timeout: 20_000 }).catch(() => null);
  await page.goto('/categories');
  await waitIdle(page);
  await expect(page, 'Không vào được trang Danh mục (bị chặn quyền / hết phiên?)').not.toHaveURL(/\/errors\/|\/auth\//);
  const tax = (await (await taxRes)?.json().catch(() => null))?.data?.currentTax;
  const vat = tax ? (tax.eInvoiceUsable ? Number(tax.vatPercent ?? 0) : 0) : NaN;
  steps.note(`Thiết lập thuế hiện tại: ${Number.isNaN(vat) ? '(không đọc được)' : `VAT mặc định ${vat}%`}`);
  const { total } = await searchBody(listRes);
  const treeBody = await (await treeRes)?.json().catch(() => null);
  const names = resolveNames(treeBody?.data ?? treeBody ?? []);
  return { vat, total, names };
}

/**
 * Thanh phân trang: hơn 20 dòng → PHẢI hiện (Trang x / y); từ 20 dòng trở xuống → PHẢI ẩn.
 * Hiện thì kiểm tra thêm: số trang = ceil(tổng / 20), bấm "Trang sau" sang được trang 2.
 */
async function checkPagination(page: Page, steps: Steps, total: number, where: string) {
  const bar = page.locator('app-pagination').getByText(/Trang\s+\d+\s*\/\s*\d+/);
  const shouldShow = total > PAGE_SIZE;
  const shown = await bar.isVisible();
  steps.check(
    shown === shouldShow,
    `Phân trang ${where}: ${total} dòng → phải ${shouldShow ? 'HIỆN' : 'ẨN'}`,
    `đang ${shown ? 'hiện' : 'ẩn'}`,
  );
  if (!shown || !shouldShow) return;

  const pages = Math.ceil(total / PAGE_SIZE);
  const text = ((await bar.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  steps.check(new RegExp(`Trang\\s*1\\s*/\\s*${pages}\\b`).test(text), `Số trang = ${pages} (${total} dòng / ${PAGE_SIZE})`, `đang hiện "${text}"`);
  await page.locator('app-pagination').scrollIntoViewIfNeeded();
  await steps.shot(`Phân trang ${where}`);

  const next = page.getByTitle('Trang sau');
  const res = page.waitForResponse(isSearch, { timeout: 15_000 }).catch(() => null);
  await next.click();
  const { items } = await searchBody(res);
  await waitIdle(page);
  const text2 = ((await bar.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const expectRows = Math.min(PAGE_SIZE, total - PAGE_SIZE);
  steps.check(/Trang\s*2\s*\//.test(text2) && items.length === expectRows, 'Bấm "Trang sau" → sang trang 2', `"${text2}", ${items.length} dòng (cần ${expectRows})`);
  await steps.shot(`Phân trang ${where} — trang 2`);
}

/** Chọn cấp 1 > cấp 2 trong ô chọn danh mục dạng cây của popup */
async function pickLv1Lv2(scope: ReturnType<Page['locator']>, page: Page, n: Names) {
  await scope.locator('button').first().click();
  await page.getByText(n.lv1, { exact: true }).last().click(); // mở nhóm cấp 1
  await page.getByText(n.lv2, { exact: true }).last().click(); // chọn cấp 2
  await page.waitForTimeout(300);
}

/** Lọc danh sách theo cấp 2 rồi tìm dòng có tên cấp 3 (total = số dòng sau khi lọc) */
async function findRow(page: Page, n: Names, name: string) {
  const search = page.waitForResponse(isSearch, { timeout: 15_000 }).catch(() => null);
  // Ô lọc (app-category-tree): bấm tên cấp 1 là CHỌN cấp 1 (không mở nhánh) → gõ tên cấp 2 vào ô tìm rồi chọn
  const filter = page.locator('form app-category-tree').first();
  await filter.locator('button').first().click();
  await filter.getByPlaceholder('Tìm kiếm danh mục...').fill(n.lv2);
  await page.waitForTimeout(400);
  let lv2 = filter.locator('li li span').filter({ hasText: exactRe(n.lv2) }).first();
  if (!(await lv2.isVisible())) {
    // nhánh cấp 1 chưa mở → bấm mũi tên của cấp 1
    await filter.locator('li > div').filter({ hasText: n.lv1 }).first().locator('lucide-icon, svg').last().click();
    lv2 = filter.locator('li li span').filter({ hasText: exactRe(n.lv2) }).first();
  }
  await lv2.click({ timeout: 10_000 });
  const { items, total } = await searchBody(search);
  await waitIdle(page);
  const item = items.find((x) => (x.subCategoryName ?? '').trim() === name);
  const row = page.locator('tbody tr').filter({ hasText: name }).filter({ hasNotText: `${name} (` }).first();
  return { row, item, total };
}

// Không dùng chế độ serial: bước trước chỉ sai số liệu (vd VAT) thì bước sau vẫn chạy; tạo lỗi hẳn thì bước sau báo "không thấy danh mục"
test.describe('Danh mục', () => {
  test('1. Tạo danh mục', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      const { vat, names } = await openCategories(page, steps);
      // Tên cấp 3: nhập tay thì dùng đúng tên đó (trùng → báo lỗi); để trống → "Danh mục test" (trùng thì thêm số)
      if (IN_NAME && names.lv3.some((x) => norm(x) === norm(IN_NAME))) {
        throw new Error(`Tên "${IN_NAME}" đã có trong ${names.lv1} > ${names.lv2} — đổi tên khác ở ô "Danh mục cấp 3" (hoặc để trống) rồi chạy lại`);
      }
      const name = IN_NAME || freeName(DEFAULT_NAME, names.lv3);
      fs.mkdirSync(path.dirname(nameFile(testInfo)), { recursive: true });
      fs.writeFileSync(nameFile(testInfo), name);
      steps.note(`Tạo: ${names.lv1} > ${names.lv2} > "${name}"`);

      await page.getByRole('button', { name: 'Thêm danh mục' }).click();
      const popup = page.locator('app-category-popup');
      await expect(popup.getByText('Tạo Danh Mục Mới'), 'Không mở được popup Tạo Danh Mục Mới').toBeVisible();

      await popup.locator('input[formcontrolname="subCategoryName"]').fill(name);
      await pickLv1Lv2(popup.locator('app-category-tree-select'), page, names);

      // "Cấp danh mục sẽ được xếp như sau": cấp 1 > cấp 2 > tên
      const preview = popup.locator('.bg-\\[\\#F8F8F8\\]');
      const previewText = ((await preview.textContent()) ?? '').replace(/\s+/g, ' ');
      steps.check(previewText.includes(names.lv1) && previewText.includes(names.lv2) && previewText.includes(name), 'Khung xem trước hiện đủ 3 cấp', previewText.trim());

      // Trùng tên → FE báo ngay dưới ô nhập
      if (await popup.getByText(/đã tồn tại/).isVisible()) {
        await steps.shot('Popup tạo danh mục — trùng tên');
        throw new Error(`FE báo tên "${name}" đã tồn tại trong ${names.lv1} > ${names.lv2}`);
      }

      // VAT không sửa — chỉ kiểm tra mặc định lấy theo Thiết lập thuế
      const vatLabel = ((await popup.locator('.vat-dropdown-wrapper-popup button').textContent().catch(() => '')) ?? '').trim();
      steps.check(firstPercent(vatLabel) === vat, `VAT mặc định trong popup = thuế suất Thiết lập thuế (${vat}%)`, `popup đang hiện "${vatLabel || 'không có'}"`);
      await steps.shot('Popup tạo danh mục', popup.locator('> div > div').first());

      const saved = page.waitForResponse((r) => /\/categories\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20_000 });
      await popup.getByRole('button', { name: 'Thêm Danh Mục' }).click();
      const res = await saved;
      const body = await res.json().catch(() => ({}));
      steps.check(res.ok() && body?.type !== 'error', 'Lưu danh mục thành công', `API trả ${res.status()}${body?.message ? `: ${body.message}` : ''}`);
      await expect(page.getByText('Thêm danh mục thành công').first(), 'Không thấy thông báo "Thêm danh mục thành công"').toBeVisible();
      await steps.shot('Sau khi tạo');
    } finally {
      await steps.flush();
    }
  });

  test('2. Xem danh mục', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      const { vat, total: all, names } = await openCategories(page, steps);
      const name = savedName(testInfo) ?? (IN_NAME || DEFAULT_NAME);
      steps.note(`Xem: ${names.lv1} > ${names.lv2} > "${name}"`);
      // Phân trang: toàn bộ danh mục (> 20 → phải hiện, ≤ 20 → phải ẩn)
      await checkPagination(page, steps, all, 'toàn bộ danh mục');

      const { row, item, total } = await findRow(page, names, name);
      // Phân trang sau khi lọc theo cấp 2
      await checkPagination(page, steps, total, `lọc "${names.lv2}"`);
      await expect(row, `Không thấy danh mục "${name}" trong danh sách ${names.lv1} > ${names.lv2} (bước Tạo có lỗi?)`).toBeVisible();

      const text = ((await row.textContent()) ?? '').replace(/\s+/g, ' ');
      steps.check(text.includes(names.lv1) && text.includes(names.lv2) && text.includes(name), 'Dòng hiện đúng 3 cấp', text.trim());
      const vatCell = ((await row.locator('td').nth(2).textContent()) ?? '').trim();
      steps.check(firstPercent(vatCell) === vat, `Cột %VAT = thuế suất Thiết lập thuế (${vat}%)`, `đang hiện "${vatCell}"${item ? `, dữ liệu vatRate=${item.vatRate}` : ''}`);
      await row.scrollIntoViewIfNeeded();
      await steps.shot('Danh mục vừa tạo trong danh sách');
    } finally {
      await steps.flush();
    }
  });

  test('3. Sửa danh mục', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      const { names } = await openCategories(page, steps);
      const name = savedName(testInfo) ?? (IN_NAME || DEFAULT_NAME);
      // Tên mới: "<tên> (sửa)"; đã có thì "(sửa 2)", "(sửa 3)"…
      const taken = new Set(names.lv3.map(norm));
      let edited = `${name} (sửa)`;
      for (let i = 2; taken.has(norm(edited)); i++) edited = `${name} (sửa ${i})`;

      const { row, item } = await findRow(page, names, name);
      await expect(row, `Không thấy danh mục "${name}" để sửa (bước Tạo có lỗi?)`).toBeVisible();
      const vatBefore = ((await row.locator('td').nth(2).textContent()) ?? '').trim();
      steps.note(`Đổi tên: "${name}" → "${edited}" (giữ nguyên VAT ${vatBefore})`);

      await row.locator('button[ptooltip="Sửa"]').click();
      const input = page.locator('input#subCategoryName');
      await expect(input, 'Không mở được chế độ sửa trên dòng').toBeVisible();
      await input.fill(edited);
      await steps.shot('Đang sửa');

      const saved = page.waitForResponse((r) => r.url().includes('/categories') && r.request().method() === 'PUT', { timeout: 20_000 });
      await page.locator('button[ptooltip="Lưu"]').first().click();
      const res = await saved;
      const body = await res.json().catch(() => ({}));
      steps.check(res.ok() && body?.type !== 'error', 'Lưu thay đổi thành công', `API trả ${res.status()}${body?.message ? `: ${body.message}` : ''}`);
      await waitIdle(page);

      const { row: after, item: afterItem } = await findRow(page, names, edited);
      await expect(after, `Sau khi sửa không thấy "${edited}" trong danh sách`).toBeVisible();
      const vatAfter = ((await after.locator('td').nth(2).textContent()) ?? '').trim();
      steps.check(vatAfter === vatBefore, 'VAT giữ nguyên sau khi sửa', `trước "${vatBefore}" → sau "${vatAfter}"`);
      steps.check(!afterItem || !item || afterItem.id === item.id, 'Sửa đúng danh mục cũ (không tạo mới)', afterItem && item ? `id ${item.id} → ${afterItem.id}` : '');
      await after.scrollIntoViewIfNeeded();
      await steps.shot('Sau khi sửa');
    } finally {
      await steps.flush();
    }
  });
});
