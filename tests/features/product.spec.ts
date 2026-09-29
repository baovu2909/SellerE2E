import { Locator, Page, Request, Response, TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { expect, test } from '../shared-page';
import { Steps, waitIdle } from './helpers';

/**
 * Tab SẢN PHẨM (/product) — có tạo / sửa dữ liệu thật.
 *
 *   1. Thêm sản phẩm   — điền form theo ô nhập trên trang điều khiển (trống → mặc định), ảnh không bắt buộc
 *   2. Xem sản phẩm    — dòng trong danh sách + mở trang sửa đối chiếu lại từng ô đã nhập
 *   3. Sửa sản phẩm    — đổi tên / mô tả ngắn / giá bán, đối chiếu lại
 *   4. Bộ lọc          — mỗi bộ lọc: mọi dòng trả về phải đúng điều kiện; "Đặt lại" xoá hết lọc
 *   5. Các nút         — In Tem, Thêm mới, Nhập / Xuất / Chỉnh sửa VAT (menu ☰), Chọn tất cả, menu ⋯ → Chỉnh sửa
 *   6. Phân trang      — > 20 sản phẩm phải hiện (Trang x / y, sang trang 2 được), ≤ 20 phải ẩn
 *   7. Nhập sản phẩm   — tải file mẫu; có file Excel (PRODUCT_IMPORT_FILE) thì nhập và kiểm tra kết quả
 *
 * Ô nhập (env): PRODUCT_NAME, PRODUCT_CODE (EAN-13), PRODUCT_CATEGORY (tên danh mục cấp 3), PRODUCT_SHORT_DESC,
 *   PRODUCT_SKU, PRODUCT_UNIT, PRODUCT_TYPE (hang-hoa | dich-vu), PRODUCT_COST, PRODUCT_PRICE, PRODUCT_STOCK,
 *   PRODUCT_IMAGES (đường dẫn ảnh, cách nhau bởi |), PRODUCT_EDIT_NAME, PRODUCT_EDIT_PRICE, PRODUCT_IMPORT_FILE
 */

const env = (k: string, d = '') => (process.env[k] ?? '').trim() || d;
const IN = {
  name: env('PRODUCT_NAME', 'Sản phẩm test'),
  code: env('PRODUCT_CODE'),
  category: env('PRODUCT_CATEGORY'), // trống → danh mục cấp 3 đầu tiên có trong cây
  shortDesc: env('PRODUCT_SHORT_DESC', 'Mô tả ngắn sản phẩm test'),
  sku: env('PRODUCT_SKU'),
  unit: env('PRODUCT_UNIT', 'Cái'),
  isService: env('PRODUCT_TYPE') === 'dich-vu',
  cost: Number(env('PRODUCT_COST', '100000')),
  price: Number(env('PRODUCT_PRICE', '150000')),
  // Tồn kho theo cửa hàng: [{ name, qty }] (PRODUCT_STORES, JSON). Trống → giữ cửa hàng mặc định, không nhập tồn.
  stores: ((): { name: string; qty: number | null }[] => {
    try {
      const list = JSON.parse(env('PRODUCT_STORES', '[]'));
      if (Array.isArray(list) && list.length) return list;
    } catch {
      throw new Error('PRODUCT_STORES không đúng dạng JSON [{ "name": "...", "qty": 10 }]');
    }
    // cách cũ: PRODUCT_STOCK = số lượng cho cửa hàng mặc định
    return env('PRODUCT_STOCK') ? [{ name: '', qty: Number(env('PRODUCT_STOCK')) }] : [];
  })(),
  images: env('PRODUCT_IMAGES').split('|').map((s) => s.trim()).filter(Boolean),
  importFile: env('PRODUCT_IMPORT_FILE'),
};
const EDIT = {
  name: env('PRODUCT_EDIT_NAME', `${IN.name} (sửa)`),
  price: Number(env('PRODUCT_EDIT_PRICE', String(IN.price + 10_000))),
  shortDesc: `${IN.shortDesc} (sửa)`,
};
const PAGE_SIZE = 20;

const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** khớp đúng cả chữ (bỏ khoảng trắng 2 đầu) */
const exactRe = (s: string, flags = 'i') => new RegExp(`^\\s*${escapeRe(s)}\\s*$`, flags);
const money = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const digits = (s: string | null) => Number((s ?? '').replace(/[^\d]/g, '') || NaN);

// ---------- API danh sách ----------

const isSearch = (r: Response) => r.url().includes('/products/search') && r.request().method() === 'POST' && r.ok();
interface SearchResult { items: any[]; total: number; params: any; page: number }
async function searchResult(res: Promise<Response | null>): Promise<SearchResult> {
  const r = await res;
  const body = await r?.json().catch(() => null);
  const req = r?.request().postDataJSON?.() ?? {};
  return {
    items: body?.items ?? body?.data?.items ?? [],
    total: Number(body?.total ?? body?.data?.total ?? NaN),
    params: req?.searchParams ?? {},
    page: Number(req?.page ?? 1),
  };
}
/** Chờ lần gọi tìm kiếm kế tiếp (match: điều kiện trên searchParams của request, vd đủ cả từ ngày + đến ngày) */
const nextSearch = (page: Page, match: (params: any) => boolean = () => true) =>
  page
    .waitForResponse((r) => isSearch(r) && match(r.request().postDataJSON()?.searchParams ?? {}), { timeout: 20_000 })
    .catch(() => null);

/** Sản phẩm vừa tạo — ghi ra file để các bước sau dùng lại */
const stateFile = (info: TestInfo) => path.join(info.project.outputDir, 'product-state.json');
const readState = (info: TestInfo): { id?: number; name?: string } => {
  try { return JSON.parse(fs.readFileSync(stateFile(info), 'utf8')); } catch { return {}; }
};
const writeState = (info: TestInfo, s: object) => {
  fs.mkdirSync(path.dirname(stateFile(info)), { recursive: true });
  fs.writeFileSync(stateFile(info), JSON.stringify(s));
};

async function openList(page: Page): Promise<SearchResult> {
  const res = nextSearch(page);
  await page.goto('/product');
  await waitIdle(page);
  await expect(page, 'Không vào được trang Sản phẩm (bị chặn quyền / hết phiên?)').not.toHaveURL(/\/errors\/|\/auth\//);
  return searchResult(res);
}

// ---------- điền form ----------

const field = (page: Page, name: string) => page.locator(`[formcontrolname="${name}"]`).locator('input, textarea').first();

async function fillField(page: Page, name: string, value: string | number) {
  const input = field(page, name);
  await input.click();
  await input.fill('');
  await input.pressSequentially(String(value));
  await input.blur();
}

/** Chọn danh mục cấp 3 trong ô "Danh mục" của form (gõ tên vào ô tìm rồi bấm) */
async function pickCategory(page: Page, lv3: string) {
  const tree = page.locator('app-category-tree').first();
  await tree.locator('button').first().click();
  await tree.getByPlaceholder('Tìm kiếm danh mục...').fill(lv3);
  await page.waitForTimeout(500);
  const item = tree.locator('li li li span, li li li div').filter({ hasText: exactRe(lv3) }).first();
  await item.click({ timeout: 10_000 });
  await page.waitForTimeout(300);
}

/** Danh mục cấp 3 để dùng: nhập tay → tìm đúng tên; trống → cái đầu tiên trong cây */
async function resolveCategory(page: Page): Promise<{ lv1: string; lv2: string; lv3: string }> {
  // Cây danh mục: lấy từ API mà trang Danh mục gọi (token nằm trong trình duyệt nên không gọi API trực tiếp)
  const treeRes = page.waitForResponse((r) => r.url().includes('categories/categories-tree') && r.ok(), { timeout: 20_000 }).catch(() => null);
  await page.goto('/categories');
  const tree: any[] = (await (await treeRes)?.json().catch(() => null))?.data ?? [];
  const all: { lv1: string; lv2: string; lv3: string }[] = [];
  for (const c1 of tree) for (const c2 of c1.children ?? []) for (const c3 of c2.children ?? []) all.push({ lv1: c1.name, lv2: c2.name, lv3: c3.name });
  if (!all.length) throw new Error('Chưa có danh mục cấp 3 nào — tạo danh mục trước (tab Danh mục) rồi chạy lại');
  if (!IN.category) return all[0];
  const found = all.find((c) => norm(c.lv3) === norm(IN.category));
  if (!found) throw new Error(`Không có danh mục cấp 3 "${IN.category}". Có: ${all.map((c) => c.lv3).slice(0, 30).join(', ')}`);
  return found;
}

// ---------- cửa hàng / tồn kho ----------

const storeBox = (page: Page) => page.locator('app-product-store-selector');

/** Các dòng "Cửa Hàng Đã Chọn": tên + số lượng */
async function storeRows(page: Page): Promise<{ name: string; qty: string }[]> {
  const names = await storeBox(page).locator('[formcontrolname="storeName"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const qtys = await storeBox(page).locator('[formcontrolname="quantity"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  return names.map((name, i) => ({ name: name.trim(), qty: qtys[i] ?? '' }));
}

/**
 * Chọn đúng các cửa hàng đã nhập (bỏ chọn cửa hàng khác, kể cả cửa hàng mặc định) rồi nhập số lượng.
 * Số lượng chỉ sửa được khi bật "Phụ Thuộc Tồn Kho" → có số lượng thì tự bật.
 */
async function fillStores(page: Page) {
  const named = IN.stores.filter((s) => s.name);
  if (named.length) {
    const box = storeBox(page);
    await box.locator('[role=button]').first().click();
    const items = box.locator('ul li').filter({ has: page.locator('input[type=checkbox]') });
    const want = new Set(named.map((s) => norm(s.name)));
    const all: string[] = [];
    for (let i = 0; i < (await items.count()); i++) {
      const li = items.nth(i);
      const label = ((await li.locator('span').last().textContent()) ?? '').trim();
      all.push(label);
      const checked = await li.locator('input[type=checkbox]').isChecked();
      if (checked !== want.has(norm(label))) await li.click();
    }
    const missing = named.filter((s) => !all.some((a) => norm(a) === norm(s.name)));
    if (missing.length) {
      await box.getByRole('button', { name: 'Hủy' }).click();
      throw new Error(`Không có cửa hàng: ${missing.map((s) => `"${s.name}"`).join(', ')}. Có: ${all.join(', ')}`);
    }
    await box.getByRole('button', { name: 'Chọn' }).click();
    await page.waitForTimeout(300);
  }
  if (IN.isService || !IN.stores.some((s) => s.qty !== null)) return;

  const inputs = storeBox(page).locator('[formcontrolname="quantity"] input');
  if (!(await inputs.first().isEditable())) await page.locator('amf-switch[label="Phụ Thuộc Tồn Kho"]').click();
  await expect(inputs.first(), 'Bật "Phụ Thuộc Tồn Kho" nhưng ô số lượng vẫn bị khoá').toBeEditable();
  const rows = await storeRows(page);
  for (const s of IN.stores) {
    if (s.qty === null) continue;
    const i = s.name ? rows.findIndex((r) => norm(r.name) === norm(s.name)) : 0;
    if (i < 0) throw new Error(`Đã chọn nhưng không thấy dòng cửa hàng "${s.name}"`);
    await inputs.nth(i).fill(String(s.qty));
  }
}

async function submitProduct(page: Page, steps: Steps, buttonText: string, label: string) {
  const saved = page.waitForResponse((r) => /\/products?\b/.test(new URL(r.url()).pathname) && ['POST', 'PUT'].includes(r.request().method()) && !r.url().includes('/search'), { timeout: 30_000 });
  await page.locator('app-product-bar').getByRole('button', { name: buttonText }).click();
  const res = await saved.catch(() => null);
  if (!res) {
    // Form không gửi đi → có ô bắt buộc chưa hợp lệ
    const errs = await page.locator('.text-red-500, [class*="text-danger"]').filter({ visible: true }).allTextContents();
    await steps.shot(`${label} — form báo lỗi`);
    throw new Error(`Bấm "${buttonText}" nhưng form không gửi đi. Lỗi trên form: ${errs.map((t) => t.trim()).filter(Boolean).join(' | ') || '(không thấy)'}`);
  }
  const body = await res.json().catch(() => ({}));
  const msg = String(body?.message ?? '').trim();
  // Tách câu: "Thêm sản phẩm thành công. Đồng bộ hệ thống thuế thất bại." → phần thành công ✔, việc phụ thất bại ⚠
  const sentences = msg.split(/(?<=[.!])\s+/).map((s) => s.trim()).filter(Boolean);
  const isBad = (s: string) => /thất bại|lỗi|không thành công|tồn tại/i.test(s);
  const failed = !res.ok() || body?.type === 'error' || (!/thành công/i.test(msg) && isBad(msg));
  const main = sentences.filter((s) => !isBad(s)).join(' ') || msg;
  steps.check(!failed, `${label} thành công`, `API trả ${res.status()}${(failed ? msg : main) ? `: ${failed ? msg : main}` : ''}`);
  if (!failed) for (const s of sentences.filter(isBad)) steps.warn(s.replace(/[.!]$/, ''), `${label.toLowerCase()} vẫn thành công, việc phụ này chưa được`);
  return body;
}

// ---------- đọc lại form ----------

async function checkForm(page: Page, steps: Steps, exp: { name: string; shortDesc: string; price: number }, where: string) {
  const val = async (n: string) => (await field(page, n).inputValue().catch(() => '')).trim();
  steps.check(norm(await val('productName')) === norm(exp.name), `${where}: Tên sản phẩm`, `"${await val('productName')}" (cần "${exp.name}")`);
  steps.check(norm(await val('shortDescription')) === norm(exp.shortDesc), `${where}: Mô tả ngắn`, `"${await val('shortDescription')}"`);
  if (IN.sku) steps.check((await val('sku')) === IN.sku, `${where}: Mã SKU`, `"${await val('sku')}"`);
  if (IN.code) steps.check((await val('productCode')) === IN.code, `${where}: Mã EAN`, `"${await val('productCode')}"`);
  steps.check(norm(await val('unitName')) === norm(IN.unit), `${where}: Đơn vị tính`, `"${await val('unitName')}"`);
  steps.check(digits(await val('price')) === exp.price, `${where}: Giá bán = ${money(exp.price)}`, `"${await val('price')}"`);
  if (!IN.isService) steps.check(digits(await val('costPrice')) === IN.cost, `${where}: Giá vốn = ${money(IN.cost)}`, `"${await val('costPrice')}"`);
  if (IN.stores.length) {
    const rows = await storeRows(page);
    for (const s of IN.stores) {
      const row = s.name ? rows.find((r) => norm(r.name) === norm(s.name)) : rows[0];
      const label = s.name || 'cửa hàng mặc định';
      steps.check(Boolean(row), `${where}: Có cửa hàng "${label}"`, `đang có: ${rows.map((r) => r.name).join(', ') || '(không có)'}`);
      if (row && s.qty !== null && !IN.isService) steps.check(digits(row.qty) === s.qty, `${where}: Tồn "${label}" = ${s.qty}`, `"${row.qty}"`);
    }
  }
  const imgTitle = (await page.getByText(/Ảnh sản phẩm \(\d+\/10\)/).textContent().catch(() => '')) ?? '';
  const imgCount = Number(imgTitle.match(/\((\d+)\//)?.[1] ?? NaN);
  steps.check(imgCount === IN.images.length, `${where}: Số ảnh = ${IN.images.length}`, imgTitle.trim());
}

/** Tìm sản phẩm theo tên bằng ô "Tìm kiếm theo tên sản phẩm" */
async function searchByName(page: Page, name: string): Promise<SearchResult> {
  const input = page.locator('amf-input[formcontrolname="productName"] input');
  const res = nextSearch(page);
  await input.fill(name);
  await input.press('Enter');
  const r = await searchResult(res);
  await waitIdle(page);
  return r;
}

const rowOf = (page: Page, name: string) =>
  page.locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) }).first();

/** Mở menu ⋯ của dòng rồi bấm "Chỉnh sửa" */
async function openEdit(page: Page, row: Locator) {
  await row.locator('[title="Thao tác"] button, [title="Thao tác"]').first().click();
  await page.getByRole('button', { name: 'Chỉnh sửa' }).last().click();
  await page.waitForURL(/\/product\/edit\//, { timeout: 15_000 });
  await waitIdle(page);
  await page.waitForTimeout(800);
}

// ======================================================================

test.describe('Sản phẩm', () => {
  test('1. Thêm sản phẩm', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const steps = new Steps(page, testInfo);
    try {
      const before = await openList(page);
      const cat = await resolveCategory(page);
      steps.note(`Thêm "${IN.name}" — ${cat.lv1} > ${cat.lv2} > ${cat.lv3}, ${IN.isService ? 'Dịch vụ' : 'Hàng hoá'}, giá vốn ${money(IN.cost)}, giá bán ${money(IN.price)}, ${IN.images.length} ảnh`);
      for (const f of IN.images) if (!fs.existsSync(f)) throw new Error(`Không tìm thấy file ảnh: ${f}`);

      await openList(page);
      await page.getByRole('button', { name: 'Thêm Sản Phẩm Mới' }).click();
      await page.waitForURL(/\/product\/add/);
      await waitIdle(page);

      if (IN.code) await fillField(page, 'productCode', IN.code);
      await fillField(page, 'productName', IN.name);
      await pickCategory(page, cat.lv3);
      await fillField(page, 'shortDescription', IN.shortDesc);
      if (IN.sku) await fillField(page, 'sku', IN.sku);
      if (IN.images.length) {
        await page.locator('app-upload-img input[type=file]').setInputFiles(IN.images);
        await expect(page.getByText(`Ảnh sản phẩm (${IN.images.length}/10)`), 'Ảnh chưa lên đủ trong khung xem trước').toBeVisible();
      }
      await fillField(page, 'unitName', IN.unit);
      await page.locator('amf-radio-group').getByText(IN.isService ? 'Dịch Vụ' : 'Hàng Hoá', { exact: true }).click();
      if (!IN.isService) await fillField(page, 'costPrice', IN.cost);
      await fillField(page, 'price', IN.price);
      if (IN.stores.length) await fillStores(page);
      await steps.shot('Form thêm sản phẩm');

      await submitProduct(page, steps, 'Thêm Sản Phẩm', 'Thêm sản phẩm');
      await page.waitForURL((u) => u.pathname === '/product', { timeout: 20_000 }).catch(() => {});
      const after = await searchResult(nextSearch(page));
      await waitIdle(page);
      steps.check(after.total === before.total + 1 || Number.isNaN(after.total), `Tổng sản phẩm tăng 1 (${before.total} → ${before.total + 1})`, `đang ${after.total}`);

      const found = await searchByName(page, IN.name);
      const created = found.items.find((x) => norm(x.productName) === norm(IN.name)); // mới nhất đứng đầu
      steps.check(Boolean(created), 'Sản phẩm mới có trong danh sách', created ? `id ${created.productId}, mã ${created.productCode}` : 'không thấy');
      if (created) writeState(testInfo, { id: created.productId, name: IN.name });
      await steps.shot('Danh sách sau khi thêm');
    } finally {
      await steps.flush();
    }
  });

  test('2. Xem sản phẩm', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const steps = new Steps(page, testInfo);
    try {
      const st = readState(testInfo);
      const name = st.name ?? IN.name;
      await openList(page);
      const r = await searchByName(page, name);
      const item = r.items.find((x) => (st.id ? x.productId === st.id : norm(x.productName) === norm(name)));
      expect(item, `Không thấy sản phẩm "${name}" (bước Thêm có lỗi?)`).toBeTruthy();

      const row = rowOf(page, name);
      await expect(row, `Dòng "${name}" không hiện trên bảng`).toBeVisible();
      const text = norm((await row.textContent()) ?? '');
      steps.check(text.includes(norm(name)), 'Dòng hiện tên sản phẩm', name);
      steps.check(text.includes(norm(item.productCode)), 'Dòng hiện mã sản phẩm', item.productCode);
      steps.check(text.includes(norm(item.categoryNameLevel3 ?? '')), 'Dòng hiện danh mục', `${item.categoryNameLevel2} > ${item.categoryNameLevel3}`);
      steps.check(text.includes(IN.price.toLocaleString('vi-VN')) || text.includes(IN.price.toLocaleString('en-US')), `Dòng hiện giá bán ${money(IN.price)}`, '');
      steps.check(Number(item.price) === IN.price, `Dữ liệu giá bán = ${money(IN.price)}`, `${item.price}`);
      if (!IN.isService) steps.check(Number(item.costPrice) === IN.cost, `Dữ liệu giá vốn = ${money(IN.cost)}`, `${item.costPrice}`);
      steps.check(IN.images.length ? Boolean(item.url) : true, IN.images.length ? 'Có ảnh đại diện' : 'Không thêm ảnh', item.url ?? '(trống)');
      await steps.shot('Dòng sản phẩm trong danh sách');

      await openEdit(page, row);
      await checkForm(page, steps, { name, shortDesc: IN.shortDesc, price: IN.price }, 'Trang chi tiết');
      await steps.shot('Trang chi tiết sản phẩm');
    } finally {
      await steps.flush();
    }
  });

  test('3. Sửa sản phẩm', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const steps = new Steps(page, testInfo);
    try {
      const st = readState(testInfo);
      const name = st.name ?? IN.name;
      steps.note(`Sửa: tên "${name}" → "${EDIT.name}", giá bán ${money(IN.price)} → ${money(EDIT.price)}, mô tả ngắn → "${EDIT.shortDesc}"`);
      await openList(page);
      await searchByName(page, name);
      const row = rowOf(page, name);
      await expect(row, `Không thấy sản phẩm "${name}" để sửa (bước Thêm có lỗi?)`).toBeVisible();
      await openEdit(page, row);
      const url = page.url();

      await fillField(page, 'productName', EDIT.name);
      await fillField(page, 'shortDescription', EDIT.shortDesc);
      await fillField(page, 'price', EDIT.price);
      await steps.shot('Form sửa sản phẩm');
      await submitProduct(page, steps, 'Lưu', 'Lưu sản phẩm');
      await waitIdle(page);

      // Mở lại trang sửa → dữ liệu mới
      await page.goto(url);
      await waitIdle(page);
      await page.waitForTimeout(800);
      await checkForm(page, steps, { name: EDIT.name, shortDesc: EDIT.shortDesc, price: EDIT.price }, 'Sau khi sửa');
      await steps.shot('Trang chi tiết sau khi sửa');
      writeState(testInfo, { ...st, name: EDIT.name });
    } finally {
      await steps.flush();
    }
  });

  test('4. Bộ lọc', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const steps = new Steps(page, testInfo);
    try {
      const all = await openList(page);
      steps.note(`Không lọc: ${all.total} sản phẩm`);
      const sample = all.items[0];
      expect(sample, 'Danh sách trống — không có dữ liệu để thử bộ lọc').toBeTruthy();

      /**
       * Áp 1 bộ lọc → mọi dòng trả về phải thoả `ok`; bảng hiện đúng số dòng; xong bấm "Đặt lại".
       * show(x) = giá trị thực tế của dòng (vd "trạng thái = Mới") để báo rõ dòng sai sai ở đâu.
       */
      const tryFilter = async (
        label: string,
        need: string,
        apply: () => Promise<void>,
        ok: (x: any) => boolean,
        show: (x: any) => string,
        match?: (params: any) => boolean,
      ) => {
        const res = nextSearch(page, match);
        await apply();
        const r = await searchResult(res);
        await waitIdle(page);
        const bad = r.items.filter((x) => !ok(x));
        steps.check(
          bad.length === 0,
          `Lọc ${label}: ${r.total} kết quả đều có ${need}`,
          bad.length ? `${bad.length} dòng sai — ${bad.slice(0, 5).map((x) => `"${x.productName}": ${show(x)}`).join('; ')}${bad.length > 5 ? '…' : ''}` : '',
        );
        const rows = await page.locator('tbody tr').filter({ has: page.locator('amf-checkbox') }).count();
        steps.check(rows === r.items.length, `Lọc ${label}: bảng hiện ${r.items.length} dòng`, `bảng có ${rows}`);
        await steps.shot(`Lọc ${label}`);
        const reset = nextSearch(page);
        await page.getByRole('button', { name: 'Đặt lại' }).click();
        const back = await searchResult(reset);
        await waitIdle(page);
        steps.check(back.total === all.total, `Đặt lại sau khi lọc ${label} → về ${all.total} sản phẩm`, `đang ${back.total}`);
      };

      // Mã sản phẩm
      await tryFilter(`mã "${sample.productCode}"`, `mã chứa "${sample.productCode}"`, async () => {
        const i = page.locator('amf-input[formcontrolname="productCode"] input');
        await i.fill(sample.productCode);
        await i.press('Enter');
      }, (x) => norm(x.productCode).includes(norm(sample.productCode)), (x) => `mã = ${x.productCode}`);

      // Tên sản phẩm (một phần tên)
      const part = sample.productName.split(/\s+/)[0];
      await tryFilter(`tên chứa "${part}"`, `tên chứa "${part}"`, async () => {
        const i = page.locator('amf-input[formcontrolname="productName"] input');
        await i.fill(part);
        await i.press('Enter');
      }, (x) => norm(x.productName).includes(norm(part)), (x) => `tên = ${x.productName}`);

      // Danh mục (cấp 2 của sản phẩm mẫu)
      await tryFilter(`danh mục "${sample.categoryNameLevel2}"`, `danh mục cấp 2 "${sample.categoryNameLevel2}"`, async () => {
        const tree = page.locator('app-category-tree').first();
        await tree.locator('button').first().click();
        await tree.getByPlaceholder('Tìm kiếm danh mục...').fill(sample.categoryNameLevel2);
        await page.waitForTimeout(400);
        await tree.locator('li li span').filter({ hasText: exactRe(sample.categoryNameLevel2) }).first().click();
      }, (x) => x.categoryIdLevel2 === sample.categoryIdLevel2, (x) => `danh mục = ${x.categoryNameLevel2} > ${x.categoryNameLevel3}`);

      // Các ô chọn — mỗi lựa chọn: [ô lọc, lựa chọn, tên cột trên bảng, cách đọc giá trị của dòng, giá trị cần]
      // Cột "Trạng thái" trên bảng lấy từ processApro (0 Mới, 1 Đã duyệt, 2 Từ chối) — KHÔNG phải trường status
      const TYPE: Record<string, string> = { '1': 'Hàng Hoá', '2': 'Dịch Vụ' };
      const APPROVE: Record<string, string> = { '0': 'Mới', '1': 'Đã duyệt', '2': 'Từ chối' };
      const selects: [string, string, string, (x: any) => string][] = [
        ['Loại sản phẩm', 'Hàng Hoá', 'loại', (x) => TYPE[String(x.productType)] ?? `(${x.productType})`],
        ['Loại sản phẩm', 'Dịch Vụ', 'loại', (x) => TYPE[String(x.productType)] ?? `(${x.productType})`],
        ['Ẩn/Hiện tại quầy', 'Hiện', 'tại quầy', (x) => (x.isActive ? 'Hiện' : 'Ẩn')],
        ['Ẩn/Hiện tại quầy', 'Ẩn', 'tại quầy', (x) => (x.isActive ? 'Hiện' : 'Ẩn')],
        ['Trạng thái phiếu', 'Mới', 'trạng thái', (x) => APPROVE[String(x.processApro ?? 0)] ?? `(${x.processApro})`],
        ['Trạng thái phiếu', 'Đã duyệt', 'trạng thái', (x) => APPROVE[String(x.processApro ?? 0)] ?? `(${x.processApro})`],
        ['Trạng thái phiếu', 'Từ chối', 'trạng thái', (x) => APPROVE[String(x.processApro ?? 0)] ?? `(${x.processApro})`],
      ];
      for (const [label, option, col, value] of selects) {
        await tryFilter(`${label} = ${option}`, `${col} "${option}"`, async () => {
          await page.locator(`amf-select[label="${label}"]`).locator('button').first().click();
          await page.locator('button, li, [role=option]').filter({ hasText: exactRe(option, '') }).filter({ visible: true }).last().click();
        }, (x) => value(x) === option, (x) => `${col} = ${value(x)} (cần ${option})`);
      }

      // Khoảng ngày tạo: ngày tạo của sản phẩm mẫu
      const day = new Date(sample.createAt);
      const dd = `${String(day.getDate()).padStart(2, '0')}${String(day.getMonth() + 1).padStart(2, '0')}${day.getFullYear()}`;
      const iso = sample.createAt.slice(0, 10);
      await tryFilter(`ngày tạo ${iso}`, `ngày tạo ${iso}`, async () => {
        // ô ngày tự xử lý từng phím (ngày → tháng → năm): vào ô, lùi về phần "ngày" rồi gõ 8 chữ số
        const inputs = page.locator('amf-daterange input');
        for (const i of [0, 1]) {
          const input = inputs.nth(i);
          await input.focus();
          await input.press('ArrowLeft');
          await input.press('ArrowLeft');
          await input.pressSequentially(dd);
        }
        await page.keyboard.press('Escape');
      }, (x) => String(x.createAt).slice(0, 10) === iso, (x) => `ngày tạo = ${String(x.createAt).slice(0, 10)}`, (p) => Boolean(p.fromDate && p.toDate));
    } finally {
      await steps.flush();
    }
  });

  test('5. Các nút', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const steps = new Steps(page, testInfo);
    const menu = () => page.locator('.list-menu-wrapper amf-button button').first();
    try {
      await openList(page);

      // In Tem Mã Vạch → trang in tem
      await page.getByRole('button', { name: 'In Tem Mã Vạch' }).click();
      steps.check(await page.waitForURL(/\/product\/barcode-print/, { timeout: 10_000 }).then(() => true, () => false), 'Nút "In Tem Mã Vạch" → trang In Tem Mã Vạch', page.url());
      await steps.shot('In Tem Mã Vạch');

      // Thêm Sản Phẩm Mới → form thêm
      await openList(page);
      await page.getByRole('button', { name: 'Thêm Sản Phẩm Mới' }).click();
      steps.check(await page.waitForURL(/\/product\/add/, { timeout: 10_000 }).then(() => true, () => false), 'Nút "Thêm Sản Phẩm Mới" → form Thêm Sản Phẩm Mới', page.url());

      // Menu ☰ → Nhập sản phẩm → popup
      await openList(page);
      await menu().click();
      await page.getByRole('button', { name: 'Nhập sản phẩm' }).click();
      const dialog = page.locator('[role=dialog]').filter({ hasText: 'Nhập sản phẩm' });
      steps.check(await dialog.isVisible().catch(() => false) || await page.getByText('File Excel').isVisible(), 'Menu ☰ → "Nhập sản phẩm" mở popup nhập', '');
      await steps.shot('Popup Nhập sản phẩm');
      await page.getByRole('button', { name: 'Hủy' }).last().click();

      // Menu ☰ → Xuất sản phẩm → tải file
      await menu().click();
      const dl = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
      await page.getByRole('button', { name: 'Xuất sản phẩm' }).click();
      const file = await dl;
      steps.check(Boolean(file), 'Menu ☰ → "Xuất sản phẩm" tải được file', file ? file.suggestedFilename() : 'không có file tải về');
      if (file) {
        const p = testInfo.outputPath(file.suggestedFilename());
        await file.saveAs(p);
        steps.check(fs.statSync(p).size > 0, 'File xuất có dữ liệu', `${fs.statSync(p).size} byte`);
      }

      // Menu ☰ → Chỉnh sửa VAT: khoá khi chưa chọn dòng, chọn 1 dòng thì mở được
      await menu().click();
      const vatBtn = page.getByRole('button', { name: 'Chỉnh sửa VAT' });
      steps.check(await vatBtn.isDisabled(), '"Chỉnh sửa VAT" bị khoá khi chưa chọn sản phẩm', '');
      await page.keyboard.press('Escape');
      await page.mouse.click(1590, 890);
      await page.locator('tbody tr').first().locator('amf-checkbox label').click();
      await menu().click();
      steps.check(await vatBtn.isEnabled(), '"Chỉnh sửa VAT" bật khi đã chọn 1 sản phẩm', '');
      await vatBtn.click();
      await page.waitForTimeout(500);
      await steps.shot('Popup Chỉnh sửa VAT');
      steps.check(await page.getByText(/VAT/i).filter({ visible: true }).count() > 1, 'Bấm "Chỉnh sửa VAT" mở popup', '');

      // Chọn tất cả
      await openList(page);
      await page.locator('thead amf-checkbox label').first().click();
      await page.waitForTimeout(300);
      // amf-checkbox: trạng thái nằm ở class của ô (chk-checked / chk-unchecked)
      const n = await page.locator('tbody tr amf-checkbox .chk-box').count();
      const checked = await page.locator('tbody tr amf-checkbox .chk-box.chk-checked').count();
      steps.check(n > 0 && checked === n, 'Tick "chọn tất cả" → mọi dòng được chọn', `${checked}/${n}`);
      await steps.shot('Chọn tất cả');

      // Menu ⋯ → Chỉnh sửa
      await openList(page);
      await openEdit(page, page.locator('tbody tr').first());
      steps.check(/\/product\/edit\//.test(page.url()), 'Menu ⋯ → "Chỉnh sửa" mở trang Cập Nhật Sản Phẩm', page.url());
      await steps.shot('Trang Chỉnh sửa');
    } finally {
      await steps.flush();
    }
  });

  test('6. Phân trang', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      const r = await openList(page);
      const bar = page.locator('app-pagination').getByText(/Trang\s+\d+\s*\/\s*\d+/);
      const shouldShow = r.total > PAGE_SIZE;
      const shown = await bar.isVisible();
      steps.check(shown === shouldShow, `${r.total} sản phẩm → phân trang phải ${shouldShow ? 'HIỆN' : 'ẨN'}`, `đang ${shown ? 'hiện' : 'ẩn'}`);
      steps.check(r.items.length === Math.min(PAGE_SIZE, r.total), `Trang 1 có ${Math.min(PAGE_SIZE, r.total)} dòng`, `${r.items.length}`);
      if (shown && shouldShow) {
        const pages = Math.ceil(r.total / PAGE_SIZE);
        const text = ((await bar.textContent()) ?? '').replace(/\s+/g, ' ');
        steps.check(new RegExp(`Trang\\s*1\\s*/\\s*${pages}\\b`).test(text), `Số trang = ${pages}`, text.trim());
        await page.locator('app-pagination').scrollIntoViewIfNeeded();
        await steps.shot('Phân trang — trang 1');

        const res = nextSearch(page);
        await page.getByTitle('Trang sau').click();
        const p2 = await searchResult(res);
        await waitIdle(page);
        const need = Math.min(PAGE_SIZE, r.total - PAGE_SIZE);
        steps.check(p2.page === 2 && p2.items.length === need, `"Trang sau" → trang 2 có ${need} dòng`, `trang ${p2.page}, ${p2.items.length} dòng`);
        const overlap = p2.items.filter((x) => r.items.some((y) => y.productId === x.productId));
        steps.check(overlap.length === 0, 'Trang 2 không lặp sản phẩm của trang 1', overlap.length ? `${overlap.length} trùng` : '');
        await steps.shot('Phân trang — trang 2');

        const res1 = nextSearch(page);
        await page.getByTitle('Trang trước').click();
        const back = await searchResult(res1);
        steps.check(back.page === 1, '"Trang trước" → về trang 1', `trang ${back.page}`);
      }
    } finally {
      await steps.flush();
    }
  });

  test('7. Nhập sản phẩm', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const steps = new Steps(page, testInfo);
    try {
      const before = await openList(page);
      await page.locator('.list-menu-wrapper amf-button button').first().click();
      await page.getByRole('button', { name: 'Nhập sản phẩm' }).click();
      const box = page.locator('.p-dialog, [role=dialog]').filter({ hasText: 'File Excel' }).last();
      await expect(box, 'Không mở được popup Nhập sản phẩm').toBeVisible();

      // Tải file mẫu
      const dl = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
      await box.getByText('Tải file mẫu').click();
      const tpl = await dl;
      steps.check(Boolean(tpl), '"Tải file mẫu" tải được file', tpl?.suggestedFilename() ?? 'không có file');
      if (tpl) await tpl.saveAs(testInfo.outputPath(tpl.suggestedFilename()));

      const importBtn = box.getByRole('button', { name: /Nhập dữ liệu|Đang nhập/ });
      steps.check(await importBtn.isDisabled(), '"Nhập dữ liệu" bị khoá khi chưa chọn file', '');

      if (!IN.importFile) {
        steps.note('Chưa chọn file Excel trên trang điều khiển → chỉ kiểm tra tải file mẫu + nút bị khoá');
        await steps.shot('Popup Nhập sản phẩm');
        return;
      }
      if (!fs.existsSync(IN.importFile)) throw new Error(`Không tìm thấy file: ${IN.importFile}`);
      steps.note(`Nhập file: ${path.basename(IN.importFile)}`);
      await box.locator('input[type=file]').setInputFiles(IN.importFile);
      await expect(box.getByText(path.basename(IN.importFile)), 'Popup chưa hiện tên file đã chọn').toBeVisible();
      await steps.shot('Đã chọn file');

      const res = page.waitForResponse((r) => /product/i.test(r.url()) && /import/i.test(r.url()), { timeout: 60_000 }).catch(() => null);
      await importBtn.click();
      const r = await res;
      await page.waitForTimeout(1500);
      const errorShown = await box.getByText('Dữ liệu import có lỗi').isVisible().catch(() => false);
      if (errorShown) {
        const msg = ((await box.textContent()) ?? '').replace(/\s+/g, ' ');
        await steps.shot('Nhập lỗi');
        steps.check(false, 'Nhập sản phẩm thành công', `Hệ thống báo lỗi: ${msg.slice(msg.indexOf('Dữ liệu import có lỗi'), 300)}`);
        return;
      }
      steps.check(Boolean(r?.ok()), 'Nhập sản phẩm thành công', `API trả ${r?.status() ?? 'không phản hồi'}`);
      const after = await openList(page);
      steps.check(after.total > before.total, `Tổng sản phẩm tăng (${before.total} → ${after.total})`, `thêm ${after.total - before.total}`);
      await steps.shot('Danh sách sau khi nhập');
    } finally {
      await steps.flush();
    }
  });
});
