import { Locator, Page, Response } from '@playwright/test';
import { expect, test } from '../shared-page';
import { Steps, checkPagination, escapeRe, exactRe, norm, stateStore, waitIdle } from './helpers';

/**
 * Tab CỬA HÀNG (/store-manager) — có tạo / sửa dữ liệu thật.
 *
 *   1. Tạo cửa hàng    — popup "Thêm Cửa Hàng" theo ô nhập trên trang điều khiển (trống → mặc định)
 *   2. Xem cửa hàng    — dòng trong danh sách + khung "Chi tiết cửa hàng" đối chiếu từng ô
 *   3. Sửa cửa hàng    — sửa tên / email / hotline trong khung chi tiết → "Lưu Chỉnh Sửa" → mở lại đối chiếu
 *   4. Bộ lọc          — tìm tên / người liên hệ, ngày tạo, trạng thái; "Xoá lọc" / bỏ lọc về đủ
 *   5. Các nút         — Thêm Cửa Hàng, menu ⋯: Xem chi tiết, Ngưng hoạt động → Kích hoạt lại (chỉ trên cửa hàng test),
 *                        Xoá cửa hàng (chỉ mở hộp xác nhận rồi Huỷ)
 *   6. Phân trang
 *
 * Ô nhập (env): STORE_NAME, STORE_COUNT (số cửa hàng tạo, 1–50), STORE_LOCATION_CODE, STORE_HOTLINE, STORE_EMAIL, STORE_ADDRESS, STORE_PROVINCE, STORE_WARD,
 *   STORE_EDIT_NAME, STORE_EDIT_HOTLINE, STORE_EDIT_EMAIL
 */

const env = (k: string, d = '') => (process.env[k] ?? '').trim() || d;
const randomCode = () => String(10000 + Math.floor(Math.random() * 89999));
const COUNT = Math.max(1, Math.min(50, Number(env('STORE_COUNT', '1')) || 1));
const IN = {
  name: env('STORE_NAME'), // trống → "Cửa hàng test" (trùng thì thêm số)
  code: env('STORE_LOCATION_CODE'), // trống → số ngẫu nhiên (mỗi cửa hàng 1 mã)
  hotline: env('STORE_HOTLINE', '0901234567'),
  email: env('STORE_EMAIL', 'cuahangtest@example.com'),
  address: env('STORE_ADDRESS', '123 Đường Test'),
  province: env('STORE_PROVINCE', 'Thành phố Hà Nội'),
  ward: env('STORE_WARD'), // trống → phường/xã đầu tiên
};
const DEFAULT_NAME = 'Cửa hàng test';
const EDIT = {
  name: env('STORE_EDIT_NAME'), // trống → "<tên> (sửa)"
  hotline: env('STORE_EDIT_HOTLINE', '0909999999'),
  email: env('STORE_EDIT_EMAIL', 'cuahangtest.sua@example.com'),
};

interface Created { id?: number; name: string; code: string; province: string; ward: string }
interface State extends Created { all: Created[] }

// ---------- danh sách ----------

const isSearch = (r: Response) => r.url().includes('/stores/search-stores') && r.request().method() === 'POST' && r.ok();
const nextSearch = (page: Page, match: (params: any) => boolean = () => true) =>
  page
    .waitForResponse((r) => isSearch(r) && match(r.request().postDataJSON()?.searchParams ?? {}), { timeout: 20_000 })
    .catch(() => null);
async function result(res: Promise<Response | null>) {
  const r = await res;
  const body = await r?.json().catch(() => null);
  return { items: (body?.items ?? []) as any[], total: Number(body?.total ?? NaN), page: Number(r?.request().postDataJSON()?.page ?? 1) };
}

async function openList(page: Page) {
  const res = nextSearch(page);
  await page.goto('/store-manager');
  await waitIdle(page);
  await expect(page, 'Không vào được trang Cửa hàng (bị chặn quyền / hết phiên?)').not.toHaveURL(/\/errors\/|\/auth\//);
  return result(res);
}

const searchBox = (page: Page) => page.locator('amf-input[label^="Tìm kiếm theo tên cửa hàng"] input');

async function searchName(page: Page, text: string) {
  const res = nextSearch(page, (p) => norm(p.storeName ?? '') === norm(text) || norm(p.contactName ?? '') === norm(text));
  await searchBox(page).fill(text);
  await searchBox(page).press('Enter');
  const r = await result(res);
  await waitIdle(page);
  return r;
}

const rowOf = (page: Page, name: string) =>
  page.locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) }).first();

async function openMenu(page: Page, row: Locator, item: string | RegExp) {
  await row.locator('[title="Thao tác"] button, [title="Thao tác"]').first().click();
  await page.getByRole('button', { name: item }).last().click();
}

// ---------- khung chi tiết ----------

const drawer = (page: Page) => page.locator('app-store-detail');
/** Nút bút chì trong khung chi tiết (theo thứ tự): 1 tên, 2 mã ĐĐKD, 3 ký hiệu HĐ, 4 email, 5 hotline, 6 địa chỉ */
const PENCIL = { name: 1, code: 2, symbol: 3, email: 4, hotline: 5, address: 6 };
const pencil = (page: Page, i: number) => drawer(page).locator('button').filter({ hasNotText: /\S/ }).nth(i);

async function openDetail(page: Page, name: string) {
  await searchName(page, name);
  const row = rowOf(page, name);
  await expect(row, `Không thấy cửa hàng "${name}" trong danh sách`).toBeVisible();
  await openMenu(page, row, 'Xem chi tiết');
  await expect(drawer(page).getByText('Chi tiết cửa hàng'), 'Không mở được khung Chi tiết cửa hàng').toBeVisible();
  await waitIdle(page);
  await page.waitForTimeout(500);
}

/** Chữ của 1 ô trong khung chi tiết (theo nhãn) */
async function detailValue(page: Page, label: string) {
  const text = ((await drawer(page).innerText()) ?? '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => norm(l.replace(/\*$/, '')) === norm(label));
  const next = lines[i + 1] ?? '';
  const labels = ['mã địa điểm kinh doanh', 'ký hiệu hóa đơn', 'email', 'số hotline', 'địa chỉ địa điểm kinh doanh', 'trạng thái hoạt động'];
  return i < 0 || labels.includes(norm(next.replace(/\*$/, ''))) ? '' : next;
}

/** Chọn 1 lựa chọn trong amf-select (có ô tìm): gõ để lọc rồi bấm; trống → lựa chọn đầu tiên. Trả về chữ đã chọn */
async function pickSelect(page: Page, select: Locator, want: string, what: string) {
  await select.locator('button').first().click();
  const search = page.getByPlaceholder(/Tìm kiếm/).filter({ visible: true }).last();
  await expect(search, `Không mở được danh sách ${what}`).toBeVisible();
  if (want) await search.fill(want);
  await page.waitForTimeout(400);
  // amf-select: khung trôi (div.fixed) gồm ô tìm + danh sách nút; bỏ dòng "Chọn …"
  const panel = page.locator('div.fixed').filter({ has: search }).last();
  const options = panel.locator('.overflow-y-auto button').filter({ visible: true }).filter({ hasNotText: /^\s*(Chọn |$)/ });
  // khớp đúng tên trước; không có thì lấy tên CHỨA chữ đã nhập (vd "Đồng nai" → "Thành phố Đồng Nai")
  let option = want ? options.filter({ hasText: exactRe(want) }).first() : options.first();
  if (want && !(await option.isVisible().catch(() => false))) option = options.filter({ hasText: new RegExp(escapeRe(want), 'i') }).first();
  if (!(await option.isVisible().catch(() => false))) {
    await search.fill('');
    await page.waitForTimeout(300);
    const some = (await options.allTextContents()).map((t) => t.trim()).filter(Boolean).slice(0, 15);
    await page.keyboard.press('Escape');
    throw new Error(`Không có ${what} nào chứa "${want}". Một số lựa chọn: ${some.join(', ')}${some.length === 15 ? '…' : ''}`);
  }
  const text = ((await option.textContent()) ?? '').trim();
  await option.click();
  return text;
}

const baseName = () => IN.name || DEFAULT_NAME;

/**
 * Tên sẽ tạo. 1 cửa hàng: đúng tên nhập (trống → "Cửa hàng test", trùng thì thêm số).
 * Nhiều cửa hàng: "<tên> <số>" nối tiếp số lớn nhất đang có, vd đã có "Emolite Shop 30" → 31, 32…
 */
async function planNames(page: Page): Promise<string[]> {
  const base = baseName();
  const taken = (await searchName(page, base)).items.map((x) => String(x.storeName).trim());
  if (COUNT === 1) {
    if (IN.name) return [IN.name];
    let name = base;
    for (let i = 2; taken.some((t) => norm(t) === norm(name)); i++) name = `${base} ${i}`;
    return [name];
  }
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)$`, 'i');
  const max = Math.max(0, ...taken.map((t) => Number(t.match(re)?.[1] ?? 0)));
  return Array.from({ length: COUNT }, (_, i) => `${base} ${max + i + 1}`);
}

/** Tạo 1 cửa hàng qua popup "Thêm Cửa Hàng". Lỗi thì ghi ✘ và trả về null (chạy tiếp cửa hàng sau) */
async function createOne(page: Page, steps: Steps, name: string, code: string, shot: boolean): Promise<Created | null> {
  const modal = page.locator('app-create-store');
  const heading = modal.getByRole('heading', { name: 'Thêm Cửa Hàng' });
  await page.getByRole('button', { name: 'Thêm Cửa Hàng' }).click();
  await expect(heading, 'Không mở được popup Thêm Cửa Hàng').toBeVisible();
  const input = (label: string) => modal.locator(`amf-input[label="${label}"] input`);
  await input('Tên Cửa Hàng').fill(name);
  await input('Mã Địa Điểm Kinh Doanh').fill(code);
  await input('Số Hotline').fill(IN.hotline);
  await input('Email').fill(IN.email);
  await input('Địa Chỉ Địa Điểm Kinh Doanh').fill(IN.address);
  const province = await pickSelect(page, modal.locator('amf-select[label="Tỉnh/Thành Phố"]'), IN.province, 'tỉnh/thành phố');
  await expect(modal.locator('amf-select[label="Phường/Xã"] button').first(), 'Chọn tỉnh xong mà ô Phường/Xã vẫn khoá').toBeEnabled();
  const ward = await pickSelect(page, modal.locator('amf-select[label="Phường/Xã"]'), IN.ward, 'phường/xã');
  if (shot) await steps.shot('Popup thêm cửa hàng', modal.locator('> div').first());

  const saved = page.waitForResponse((r) => /\/stores\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null);
  await modal.getByRole('button', { name: 'Tạo Cửa Hàng' }).click();
  const res = await saved;
  if (!res) {
    const errs = await modal.locator('[class*="text-red"], [class*="danger"], [class*="error"]').filter({ visible: true }).allTextContents();
    await steps.shot(`Popup báo lỗi — ${name}`);
    steps.check(false, `Tạo "${name}"`, `không gửi đi được. Lỗi trên form: ${errs.map((t) => t.trim()).filter(Boolean).join(' | ') || '(không thấy)'}`);
    await modal.getByRole('button', { name: 'Hủy' }).last().click().catch(() => {});
    return null;
  }
  const body = await res.json().catch(() => ({}));
  const msg = String(body?.message ?? '');
  const ok = res.ok() && body?.type !== 'error' && !/lỗi|thất bại|tồn tại/i.test(msg);
  steps.check(ok, `Tạo "${name}" (mã ĐĐKD ${code}) — ${province}, ${ward}`, `API trả ${res.status()}${msg ? `: ${msg}` : ''}`);
  if (!ok) {
    await modal.getByRole('button', { name: 'Hủy' }).last().click().catch(() => {});
    return null;
  }
  await expect(heading, `Popup không đóng sau khi tạo "${name}"`).toBeHidden({ timeout: 20_000 });
  await waitIdle(page);
  return { name, code, province, ward };
}

// ======================================================================

test.describe('Cửa hàng', () => {
  test('1. Tạo cửa hàng', async ({ page }, testInfo) => {
    test.setTimeout(60_000 + COUNT * 45_000);
    const steps = new Steps(page, testInfo);
    const state = stateStore<State>(testInfo, 'store');
    try {
      const before = await openList(page);
      const names = await planNames(page);
      await openList(page);
      steps.note(`Tạo ${names.length} cửa hàng: ${names.length > 5 ? `${names.slice(0, 3).join(', ')} … ${names.at(-1)}` : names.join(', ')}`);
      steps.note(`Hotline ${IN.hotline}, email ${IN.email}, địa chỉ ${IN.address}, ${IN.province}`);

      const created: Created[] = [];
      for (const [i, name] of names.entries()) {
        const code = i === 0 && IN.code ? IN.code : randomCode();
        const c = await createOne(page, steps, name, code, i === 0);
        if (c) created.push(c);
      }

      const after = await openList(page);
      steps.check(after.total === before.total + names.length, `Tổng cửa hàng tăng ${names.length} (${before.total} → ${before.total + names.length})`, `đang ${after.total}`);
      for (const c of created) {
        const found = (await searchName(page, c.name)).items.find((x) => norm(x.storeName) === norm(c.name));
        steps.check(Boolean(found), `"${c.name}" có trong danh sách`, found ? `mã ${found.storeCode}` : 'không thấy');
        if (found) c.id = found.id;
      }
      if (created.length) state.write({ ...created[0], all: created });
      if (created.length) await searchName(page, names.length > 1 ? baseName() : created[0].name);
      await steps.shot('Danh sách sau khi tạo');
    } finally {
      await steps.flush();
    }
  });

  test('2. Xem cửa hàng', async ({ page }, testInfo) => {
    const st = stateStore<State>(testInfo, 'store').read();
    const list: Created[] = st.all?.length ? st.all : [{ name: st.name ?? (IN.name || DEFAULT_NAME), code: st.code ?? IN.code, province: st.province ?? '', ward: '', id: st.id }];
    test.setTimeout(60_000 + list.length * 30_000);
    const steps = new Steps(page, testInfo);
    try {
      for (const [i, c] of list.entries()) {
        await openList(page);
        const r = await searchName(page, c.name);
        const item = r.items.find((x) => (c.id ? x.id === c.id : norm(x.storeName) === norm(c.name)));
        if (!item) {
          steps.check(false, `Có cửa hàng "${c.name}"`, 'không thấy (bước Tạo có lỗi?)');
          continue;
        }
        const row = rowOf(page, c.name);
        const text = norm((await row.textContent()) ?? '');
        steps.check(text.includes(norm(item.storeCode)) && text.includes(norm(IN.address)) && text.includes('đang hoạt động'),
          `"${c.name}": dòng hiện đúng mã, địa chỉ, trạng thái "Đang hoạt động"`, `${item.storeCode} · ${item.address} · ${item.storeStatusNameVN ?? ''}`);
        if (i === 0) await steps.shot('Dòng cửa hàng trong danh sách');

        await openMenu(page, row, 'Xem chi tiết');
        await expect(drawer(page).getByText('Chi tiết cửa hàng')).toBeVisible();
        await page.waitForTimeout(800);
        const got = {
          code: await detailValue(page, 'Mã địa điểm kinh doanh'),
          email: await detailValue(page, 'Email'),
          hotline: await detailValue(page, 'Số hotline'),
          addr: await detailValue(page, 'Địa chỉ địa điểm kinh doanh'),
        };
        steps.check(got.code === c.code, `"${c.name}" chi tiết: Mã địa điểm KD = ${c.code}`, got.code);
        steps.check(norm(got.email) === norm(IN.email), `"${c.name}" chi tiết: Email = ${IN.email}`, got.email);
        steps.check(got.hotline === IN.hotline, `"${c.name}" chi tiết: Hotline = ${IN.hotline}`, got.hotline);
        steps.check(norm(got.addr).includes(norm(IN.address)) && (!c.province || norm(got.addr).includes(norm(c.province))), `"${c.name}" chi tiết: Địa chỉ đúng`, got.addr);
        if (i === 0) await steps.shot('Khung chi tiết cửa hàng');
      }
    } finally {
      await steps.flush();
    }
  });

  test('3. Sửa cửa hàng', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const steps = new Steps(page, testInfo);
    const state = stateStore<State>(testInfo, 'store');
    const st = state.read();
    try {
      const name = st.name ?? (IN.name || DEFAULT_NAME);
      const newName = EDIT.name || `${name} (sửa)`;
      steps.note(`Sửa: tên "${name}" → "${newName}", hotline → ${EDIT.hotline}, email → ${EDIT.email}`);
      await openList(page);
      await openDetail(page, name);

      const fill = async (i: number, value: string, label: string) => {
        await pencil(page, i).click();
        const box = drawer(page).locator('input[type=text]').filter({ visible: true }).last();
        await expect(box, `Bấm bút chì ô ${label} nhưng không hiện ô nhập`).toBeVisible();
        await box.fill(value);
      };
      await fill(PENCIL.name, newName, 'Tên');
      await fill(PENCIL.email, EDIT.email, 'Email');
      await fill(PENCIL.hotline, EDIT.hotline, 'Hotline');
      await steps.shot('Đang sửa');

      const saveBtn = drawer(page).getByRole('button', { name: 'Lưu Chỉnh Sửa' });
      await expect(saveBtn, 'Đã sửa mà nút "Lưu Chỉnh Sửa" vẫn khoá').toBeEnabled();
      const saved = page.waitForResponse((r) => /\/stores\/\d+/.test(r.url()) && r.request().method() === 'PUT', { timeout: 30_000 });
      await saveBtn.click();
      // "Xác Nhận Lưu Thay Đổi?" → Xác Nhận
      const ok = page.getByRole('button', { name: 'Xác Nhận', exact: true }).filter({ visible: true }).last();
      await expect(ok, 'Bấm "Lưu Chỉnh Sửa" nhưng không hiện hộp xác nhận').toBeVisible();
      await ok.click();
      const res = await saved;
      const body = await res.json().catch(() => ({}));
      const msg = String(body?.message ?? '');
      steps.check(res.ok() && body?.type !== 'error' && !/lỗi|thất bại/i.test(msg), 'Lưu chỉnh sửa thành công', `API trả ${res.status()}${msg ? `: ${msg}` : ''}`);
      state.write({ ...st, name: newName });

      await openList(page);
      await openDetail(page, newName);
      steps.check(norm(await detailValue(page, 'Email')) === norm(EDIT.email), `Sau khi sửa: Email = ${EDIT.email}`, await detailValue(page, 'Email'));
      steps.check((await detailValue(page, 'Số hotline')) === EDIT.hotline, `Sau khi sửa: Hotline = ${EDIT.hotline}`, await detailValue(page, 'Số hotline'));
      steps.check(await drawer(page).getByText(newName, { exact: true }).first().isVisible(), `Sau khi sửa: Tên = ${newName}`, '');
      await steps.shot('Khung chi tiết sau khi sửa');
    } finally {
      await steps.flush();
    }
  });

  test('4. Bộ lọc', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const steps = new Steps(page, testInfo);
    try {
      const all = await openList(page);
      steps.note(`Không lọc: ${all.total} cửa hàng`);
      const sample = all.items[0];
      expect(sample, 'Danh sách trống — không có dữ liệu để thử bộ lọc').toBeTruthy();

      const tryFilter = async (label: string, need: string, apply: () => Promise<void>, clear: () => Promise<void>, ok: (x: any) => boolean, show: (x: any) => string, match?: (p: any) => boolean) => {
        const res = nextSearch(page, match);
        await apply();
        const r = await result(res);
        await waitIdle(page);
        const bad = r.items.filter((x) => !ok(x));
        if (!r.items.length) steps.warn(`Lọc ${label}: 0 kết quả`, `không có dữ liệu có ${need} để kiểm tra`);
        else steps.check(bad.length === 0, `Lọc ${label}: ${r.total} kết quả đều có ${need}`,
          bad.length ? `${bad.length} dòng sai — ${bad.slice(0, 5).map((x) => `"${x.storeName}": ${show(x)}`).join('; ')}` : '');
        const rows = await page.locator('tbody tr').filter({ has: page.locator('[title="Thao tác"]') }).count();
        steps.check(rows === r.items.length, `Lọc ${label}: bảng hiện ${r.items.length} dòng`, `bảng có ${rows}`);
        await steps.shot(`Lọc ${label}`);
        const back = nextSearch(page);
        await clear();
        const b = await result(back);
        await waitIdle(page);
        steps.check(b.total === all.total, `Bỏ lọc ${label} → về ${all.total} cửa hàng`, `đang ${b.total}`);
      };

      // Tên cửa hàng (1 phần tên)
      const part = sample.storeName.split(/\s+/)[0];
      await tryFilter(`tên chứa "${part}"`, `tên hoặc người liên hệ chứa "${part}"`,
        async () => { await searchBox(page).fill(part); await searchBox(page).press('Enter'); },
        async () => { await searchBox(page).fill(''); await searchBox(page).press('Enter'); },
        (x) => norm(x.storeName).includes(norm(part)) || norm(x.contactName ?? '').includes(norm(part)),
        (x) => `tên = ${x.storeName}, người liên hệ = ${x.contactName ?? '(trống)'}`,
        (p) => Boolean(p.storeName || p.contactName));

      // Người liên hệ
      if (sample.contactName) {
        await tryFilter(`người liên hệ "${sample.contactName}"`, `tên hoặc người liên hệ chứa "${sample.contactName}"`,
          async () => { await searchBox(page).fill(sample.contactName); await searchBox(page).press('Enter'); },
          async () => { await searchBox(page).fill(''); await searchBox(page).press('Enter'); },
          (x) => norm(x.contactName ?? '').includes(norm(sample.contactName)) || norm(x.storeName).includes(norm(sample.contactName)),
          (x) => `người liên hệ = ${x.contactName ?? '(trống)'}`,
          (p) => Boolean(p.storeName || p.contactName));
      }

      // Thời gian tạo = ngày tạo của cửa hàng mẫu
      const day = new Date(sample.createdAt);
      const dd = `${String(day.getDate()).padStart(2, '0')}${String(day.getMonth() + 1).padStart(2, '0')}${day.getFullYear()}`;
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const dateInput = page.locator('amf-datepicker input');
      const localDay = (x: any) => { const d = new Date(x.createdAt); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
      await tryFilter(`ngày tạo ${iso}`, `ngày tạo ${iso}`,
        async () => {
          await dateInput.focus();
          await dateInput.press('ArrowLeft');
          await dateInput.press('ArrowLeft');
          await dateInput.pressSequentially(dd);
          await page.keyboard.press('Escape');
        },
        async () => {
          await dateInput.focus();
          await dateInput.press('Control+a');
          await dateInput.press('Backspace');
          await page.keyboard.press('Escape');
          if (await page.getByRole('button', { name: /Xóa lọc|Đặt lại/ }).isVisible().catch(() => false)) await page.getByRole('button', { name: /Xóa lọc|Đặt lại/ }).click();
        },
        (x) => localDay(x) === iso, (x) => `ngày tạo = ${localDay(x)}`, (p) => Boolean(p.createdAt));

      // Trạng thái
      for (const [option, id] of [['Đang hoạt động', 1], ['Dừng hoạt động', 0]] as const) {
        const select = page.locator('amf-select[label="Trạng thái cửa hàng"]');
        await tryFilter(`trạng thái "${option}"`, `trạng thái "${option}"`,
          async () => {
            await select.locator('button').first().click();
            await page.locator('button, li, [role=option]').filter({ hasText: exactRe(option, '') }).filter({ visible: true }).last().click();
          },
          // nút ✕ trong ô chọn (span role=button) → bỏ lọc
          async () => { await select.locator('span[role=button]').first().click(); },
          (x) => Number(x.storeStatusId) === id, (x) => `trạng thái = ${x.storeStatusNameVN ?? x.storeStatusId}`,
          (p) => Number(p.storeStatusId) === id);
      }
    } finally {
      await steps.flush();
    }
  });

  test('5. Các nút', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const steps = new Steps(page, testInfo);
    const st = stateStore<State>(testInfo, 'store').read();
    try {
      await openList(page);

      // Thêm Cửa Hàng → popup, Hủy → đóng
      const seen = (l: Locator, state: 'visible' | 'hidden' = 'visible') => l.waitFor({ state, timeout: 8_000 }).then(() => true, () => false);
      await page.getByRole('button', { name: 'Thêm Cửa Hàng' }).click();
      const heading = page.locator('app-create-store').getByRole('heading', { name: 'Thêm Cửa Hàng' });
      steps.check(await seen(heading), 'Nút "Thêm Cửa Hàng" mở popup', '');
      await steps.shot('Popup Thêm Cửa Hàng');
      await page.locator('app-create-store').getByRole('button', { name: 'Hủy' }).last().click();
      steps.check(await seen(heading, 'hidden'), 'Bấm "Hủy" đóng popup', '');

      // Menu ⋯ → Xem chi tiết
      await openMenu(page, page.locator('tbody tr').first(), 'Xem chi tiết');
      steps.check(await seen(drawer(page).getByText('Chi tiết cửa hàng')), 'Menu ⋯ → "Xem chi tiết" mở khung chi tiết', '');
      await steps.shot('Khung chi tiết');

      // Ngưng hoạt động → Kích hoạt lại: CHỈ trên cửa hàng test vừa tạo
      const name = st.name;
      if (!name) {
        steps.check(false, 'Thử "Ngưng hoạt động / Kích hoạt lại"', 'chưa có cửa hàng test (bước 1. Tạo cửa hàng chưa chạy / lỗi) — không bấm trên cửa hàng thật');
      } else {
        const toggle = async (item: RegExp, want: string) => {
          await openList(page);
          await searchName(page, name);
          const row = rowOf(page, name);
          await openMenu(page, row, item);
          const confirm = page.getByRole('button', { name: 'Xác Nhận', exact: true }).filter({ visible: true }).last();
          if (await confirm.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await confirm.click();
          await page.waitForTimeout(800);
          await waitIdle(page);
          const after = (await searchName(page, name)).items.find((x) => norm(x.storeName) === norm(name));
          steps.check(norm(after?.storeStatusNameVN ?? '') === norm(want), `Menu ⋯ → "${item.source.replace(/\\/g, '')}" → trạng thái "${want}"`, after?.storeStatusNameVN ?? 'không thấy');
          await steps.shot(`Sau khi bấm ${want}`);
        };
        // lần chạy trước lỗi giữa chừng có thể để cửa hàng test ở "Dừng hoạt động" → kích hoạt lại trước
        await openList(page);
        const now = (await searchName(page, name)).items.find((x) => norm(x.storeName) === norm(name));
        if (now && Number(now.storeStatusId) !== 1) await toggle(/Kích hoạt lại/, 'Đang hoạt động');
        await toggle(/Ngưng hoạt động/, 'Dừng hoạt động');
        await toggle(/Kích hoạt lại/, 'Đang hoạt động');
      }

      // Xoá cửa hàng → chỉ mở hộp xác nhận rồi Huỷ
      await openList(page);
      const target = name ? (await searchName(page, name), rowOf(page, name)) : page.locator('tbody tr').first();
      await openMenu(page, target, /Xóa cửa hàng|Xoá cửa hàng/);
      const cancel = page.getByRole('button', { name: /^(Hủy|Huỷ)$/ }).filter({ visible: true }).last();
      steps.check(await cancel.waitFor({ timeout: 5_000 }).then(() => true, () => false), 'Menu ⋯ → "Xoá cửa hàng" hỏi xác nhận trước khi xoá', '');
      await steps.shot('Hộp xác nhận xoá');
      if (await cancel.isVisible().catch(() => false)) await cancel.click();
      if (name) {
        const still = (await searchName(page, name)).items.some((x) => norm(x.storeName) === norm(name));
        steps.check(still, 'Bấm Huỷ → cửa hàng vẫn còn', '');
      }
    } finally {
      await steps.flush();
    }
  });

  test('6. Phân trang', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      const r = await openList(page);
      await checkPagination(page, steps, {
        total: r.total,
        firstPage: r.items,
        idOf: (x) => x.id,
        nextPage: async () => {
          const res = nextSearch(page);
          await page.getByTitle('Trang sau').click();
          const p2 = await result(res);
          await waitIdle(page);
          return p2.items;
        },
      });
    } finally {
      await steps.flush();
    }
  });
});
