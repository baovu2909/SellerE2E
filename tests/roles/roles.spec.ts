import { Browser, BrowserContext, Locator, Page, TestInfo, expect, test } from '@playwright/test';
import { autoDismissSecurityPopup } from '../../pages/common';
import { LoginPage } from '../../pages/login.page';
import { ButtonCheck, Feature, PERMISSIONS, ROLES, isAllowed } from './permission-matrix';

// Mỗi vai trò chạy trong 1 worker riêng (1 cửa sổ riêng) cùng lúc — cần --workers ≥ số vai trò (lệnh roles:* đã đặt 7)
test.describe.configure({ mode: 'parallel' });

const only = (process.env.ROLES_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const features = PERMISSIONS.flatMap((g) => g.features.map((f) => ({ ...f, group: g.group })));
const pageFeatures = features.filter((f) => f.page);
const buttonFeatures = features.filter((f) => f.button);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function waitIdle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

async function readSelectOptions(page: Page, select: Locator): Promise<string[]> {
  const visibleButtons = async () =>
    page.getByRole('button').evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
  const before = new Set(await visibleButtons());
  await select.locator('button').first().click();
  await page.waitForTimeout(500);
  const after = await visibleButtons();
  await page.keyboard.press('Escape');
  const vp = page.viewportSize();
  if (vp) await page.mouse.click(vp.width - 20, vp.height - 10);
  return after.filter((t) => t && !before.has(t) && norm(t) !== 'tất cả');
}

const DANGER = /xo[aá]|h[uủ][yỷ]|k[yý] |ký|gửi|phát hành|sao chép|vô hiệu|ngưng|tạm dừng|^in |tải|điều chỉnh|thanh toán|lưu|hoàn tất|đã đưa|đã nhận|xác nhận|đặt làm|tiếp tục/i;
const ROW_MENU = '[title="Thao tác"] button, [aria-label="More"] button, amf-button:has(svg[class*="ellipsis"]) button';
const MAX_ROWS = 20; // số dòng dò tối đa mỗi trang khi tìm nút trong menu dòng / trên dòng
const MAX_PAGES = 3; // có quyền mà chưa thấy → dò thêm trang sau

function buttonsNamed(scope: Page | Locator, name: string): Locator {
  const exact = new RegExp(`^\\s*${escapeRe(name)}\\s*$`, 'i');
  const q = name.replace(/"/g, '\\"');
  return scope
    .locator('button, a, [role=button], [role=menuitem], [role=tab], li')
    .filter({ hasText: exact })
    .or(scope.locator(`[title="${q}" i], [ptooltip="${q}" i], [aria-label="${q}" i], amf-tooltip[text="${q}" i]`))
    .filter({ visible: true });
}

async function closeMenus(page: Page) {
  await page.keyboard.press('Escape');
  const vp = page.viewportSize();
  if (vp) await page.mouse.click(vp.width - 20, vp.height - 10);
  await page.waitForTimeout(150);
}

const visibleRows = (page: Page) => page.locator('tbody tr').filter({ visible: true }).filter({ hasNot: page.locator('td[colspan]') });

async function menuItemInRow(page: Page, row: Locator, name: string): Promise<Locator | null> {
  const trigger = row.locator(ROW_MENU).first();
  if (!(await trigger.count())) return null;
  // dòng sát mép dưới → menu bật ra ngoài màn hình, không bấm được; cuộn dòng ra giữa trước
  await row.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {});
  const before = await buttonsNamed(page, name).count();
  await trigger.click();
  await page.waitForTimeout(300);
  const items = buttonsNamed(page, name);
  if ((await items.count()) > before) return items.last();
  await closeMenus(page);
  return null;
}

/** dataDependent: không thấy nút vì thiếu dữ liệu phù hợp (bảng trống / không dòng nào đúng trạng thái), không phải do quyền */
type FoundButton = { button: Locator | null; hint?: string; dataDependent?: boolean };

async function findButton(page: Page, b: ButtonCheck, allowed: boolean): Promise<FoundButton> {
  const kind = b.in ?? 'page';
  if (kind === 'page') {
    // .last(): xem clickStep() — vài tên nút trùng với nhãn menu sidebar
    const loc = buttonsNamed(page, b.name).last();
    await loc.waitFor({ state: 'visible', timeout: allowed ? 8_000 : 1_500 }).catch(() => {});
    return { button: (await loc.count()) ? loc : null };
  }

  await visibleRows(page).first().waitFor({ timeout: 8_000 }).catch(() => {});
  if (!(await visibleRows(page).count())) {
    return { button: null, dataDependent: true, hint: 'bảng không có dòng dữ liệu nào để kiểm tra' };
  }

  if (kind === 'selected') {
    const row = visibleRows(page).first();
    // .chk-box trước: checkbox tự dựng của app là <label class="chk-label">, bọc ngoài
    // <span class="chk-box"> — label ngoài rộng 0px (không "visible" với Playwright), phải bấm
    // vào .chk-box (phần tử thật sự có kích thước) mới bấm được.
    let box = row.locator('.chk-box').first();
    if (!(await box.count())) box = row.locator('amf-checkbox label, input[type=checkbox], [role=checkbox]').first();
    if (!(await box.count())) return { button: null, hint: 'dòng không có ô chọn' };
    await box.click({ timeout: 8_000 });
    await page.waitForTimeout(500);
    const loc = buttonsNamed(page, b.name).first();
    return { button: (await loc.count()) ? loc : null };
  }

  // rowHas: chỉ dò dòng có chữ này (vd trạng thái "Nháp")
  const candidates = () => (b.rowHas ? visibleRows(page).filter({ hasText: new RegExp(escapeRe(b.rowHas), 'i') }) : visibleRows(page));
  let scanned = 0;
  for (let pageNo = 1; pageNo <= (allowed ? MAX_PAGES : 1); pageNo++) {
    const rows = Math.min(await candidates().count(), MAX_ROWS);
    for (let i = 0; i < rows; i++, scanned++) {
      if (kind === 'row') {
        const loc = buttonsNamed(candidates().nth(i), b.name).first();
        if (await loc.count()) return { button: loc };
      } else {
        const item = await menuItemInRow(page, candidates().nth(i), b.name);
        if (item) return { button: item };
      }
    }
    const next = page.getByTitle('Trang sau');
    if (!(await next.isVisible())) break;
    await next.click();
    await waitIdle(page);
    await page.waitForTimeout(500);
  }
  return {
    button: null,
    dataDependent: true,
    hint: `dò ${scanned} dòng${b.rowHas ? ` "${b.rowHas}"` : ''} không dòng nào có nút này — nút chỉ hiện theo trạng thái dữ liệu (vd bản nháp, đã ký CQT…), cần có dữ liệu phù hợp`,
  };
}

async function openDetail(page: Page, spec: string): Promise<{ ok: boolean; dataDependent?: boolean; hint?: string }> {
  const [how, name] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
  const found = await findButton(page, { path: '', name, in: how === 'row' ? 'row' : 'menu' }, true);
  if (!found.button) return { ok: false, dataDependent: found.dataDependent, hint: found.hint };
  await found.button.click();
  await waitIdle(page);
  await page.waitForTimeout(800);
  return { ok: !/\/errors\//.test(page.url()) };
}

async function clickStep(page: Page, step: string): Promise<boolean> {
  // .last(): vài tên nút trùng với nhãn menu sidebar (vd "Danh Sách Nhân Viên" vừa là
  // menu /employees vừa là tab trong drawer chi tiết cửa hàng) — phần tử của drawer luôn
  // được render SAU trong DOM, giống cách menuItemInRow() chọn item mới xuất hiện.
  const loc = step.startsWith('css:') ? page.locator(step.slice(4)).filter({ visible: true }).first() : buttonsNamed(page, step).last();
  if (!(await loc.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false))) return false;
  await loc.click({ timeout: 8_000 }).catch((e) => {
    throw new Error(`Không bấm được bước "${step}" (bị che / không nhận click): ${e.message.split('\n')[0]}`);
  });
  await page.waitForTimeout(500);
  return true;
}

const REACT_TIMEOUT = 15_000; // thời gian tối đa chờ nút phản hồi sau khi bấm

async function pressAndCheck(page: Page, button: Locator, where: string, expectUrl?: string) {
  const signature = () =>
    page.evaluate(
      () =>
        `${document.body.innerText.length}:${document.querySelectorAll('*').length}:` +
        document.querySelectorAll('input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])').length,
    );
  const beforeUrl = page.url();
  const beforeSig = await signature();
  let gotFile = false;
  page.waitForEvent('download', { timeout: REACT_TIMEOUT }).then(() => (gotFile = true), () => {});
  page.context().waitForEvent('page', { timeout: REACT_TIMEOUT }).then((p) => ((gotFile = true), p.close().catch(() => {})), () => {});

  await button.click();
  // Có nút mất vài giây mới phản hồi (vd "Xem hóa đơn" chờ tạo PDF rồi mới bật popup) → dò liên tục tới REACT_TIMEOUT
  const reacted = await expect
    .poll(async () => gotFile || page.url() !== beforeUrl || (await signature()) !== beforeSig, { timeout: REACT_TIMEOUT, intervals: [500] })
    .toBe(true)
    .then(() => true, () => false);
  expect(reacted, `Bấm nút ${where} nhưng sau ${REACT_TIMEOUT / 1000} giây không thấy phản hồi gì`).toBe(true);
  await waitIdle(page);
  await expect(page, `Bấm nút ${where} bị chuyển sang trang lỗi / không có quyền`).not.toHaveURL(/\/errors\/|\/auth\//);
  if (expectUrl) await expect(page, `Bấm nút ${where} phải mở trang ${expectUrl}`).toHaveURL(new RegExp(expectUrl));
}

/** So sánh danh sách cửa hàng thấy được với danh sách được phân */
function compareStores(where: string, seen: string[], assigned: string[]) {
  const a = new Set(assigned.map(norm));
  const s = new Set(seen.map(norm));
  const extra = seen.filter((x) => !a.has(norm(x)));
  const missing = assigned.filter((x) => !s.has(norm(x)));
  expect.soft(extra, `${where}: có cửa hàng KHÔNG được phân`).toEqual([]);
  expect.soft(missing, `${where}: thiếu cửa hàng được phân`).toEqual([]);
}

for (const role of ROLES) {
  if (only.length && !only.includes(role.key)) continue;

  const fallbackUser = role.key === 'owner' ? process.env.SELLER_USERNAME : '';
  const fallbackPass = role.key === 'owner' ? process.env.SELLER_PASSWORD : '';
  const username = process.env[`${role.env}_USERNAME`] || fallbackUser || '';
  const password = process.env[`${role.env}_PASSWORD`] || fallbackPass || '';
  const stores = (process.env[`${role.env}_STORES`] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!username || !password) {
    console.log(`Bỏ qua vai trò "${role.label}": chưa điền ${role.env}_USERNAME / ${role.env}_PASSWORD trong env/.env.${process.env.ENV ?? 'dev'}`);
  }

  test.describe(`Vai trò: ${role.label}`, () => {
    // Trong 1 vai trò: test chạy tuần tự, dùng chung phiên đăng nhập; 1 test lỗi không làm bỏ qua test sau
    test.describe.configure({ mode: 'default' });
    test.skip(!username || !password, `Chưa điền ${role.env}_USERNAME / ${role.env}_PASSWORD trong env`);

    let context: BrowserContext;
    let page: Page;

    async function createSession(browser: Browser, testInfo: TestInfo) {
      const u = testInfo.project.use;
      const ctx = await browser.newContext({ baseURL: u.baseURL, viewport: u.viewport, locale: u.locale, timezoneId: u.timezoneId });
      const pg = await ctx.newPage();
      await autoDismissSecurityPopup(pg);
      pg.on('dialog', (d) => d.accept().catch(() => {}));
      const login = new LoginPage(pg);
      await login.goto();
      const source = process.env[`${role.env}_USERNAME`] ? `${role.env}_USERNAME / ${role.env}_PASSWORD` : 'SELLER_USERNAME / SELLER_PASSWORD';
      await login.login(username, password, `Kiểm tra ${source} trong env/.env.${process.env.ENV ?? 'dev'}`);
      await waitIdle(pg);
      return { ctx, pg };
    }

    test.beforeAll(async ({ browser }, testInfo) => {
      ({ ctx: context, pg: page } = await createSession(browser, testInfo));
    });

    // Nếu test trước làm đóng trình duyệt (crash/hang) hoặc phiên bị hết hạn (đá về /auth/login),
    // tự đăng nhập lại phiên mới trước khi chạy test tiếp theo — tránh cả loạt test sau đó
    // cascade-fail chỉ vì 1 lỗi gốc trước đó.
    test.beforeEach(async ({ browser }, testInfo) => {
      const expired = page.isClosed() || /\/auth\/login/.test(page.url());
      if (!expired) return;
      console.log(`[${role.label}] Phát hiện trình duyệt đóng / phiên hết hạn — đăng nhập lại phiên mới.`);
      await context?.close().catch(() => {});
      ({ ctx: context, pg: page } = await createSession(browser, testInfo));
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('Menu sidebar đúng quyền', async () => {
      await page.goto('/profile/general');
      await waitIdle(page);
      const menus = new Map<string, boolean>();
      for (const f of pageFeatures) {
        if (!f.page!.menu) continue;
        menus.set(f.page!.menu, (menus.get(f.page!.menu) ?? false) || isAllowed(f, role.key));
      }
      for (const [menu, allowed] of menus) {
        const link = page.locator('app-navbar a').filter({ hasText: new RegExp(`^\\s*${escapeRe(menu)}\\s*$`, 'i') });
        if (allowed) await expect.soft(link, `Phải THẤY menu "${menu}"`).not.toHaveCount(0);
        else await expect.soft(link, `KHÔNG được thấy menu "${menu}"`).toHaveCount(0);
      }
    });

    for (const f of pageFeatures) {
      const allowed = isAllowed(f, role.key);
      const { path, title, noBreadcrumb } = f.page!;
      test(`${allowed ? 'Được xem' : 'Bị chặn'}: ${f.name} (${path})`, async () => {
        await page.goto(path);
        await waitIdle(page);

        if (!allowed) {
          await expect(page, `Vai trò ${role.label} KHÔNG có quyền nhưng vẫn vào được ${path}`).toHaveURL(/\/errors\/403/);
          return;
        }

        await expect(page, 'Bị đá về trang đăng nhập').not.toHaveURL(/\/auth\//);
        await expect(page, `Vai trò ${role.label} CÓ quyền nhưng bị chặn`).not.toHaveURL(/\/errors\/|approval-required/);
        if (!noBreadcrumb) {
          const pageTitle = page.locator('app-page-title');
          await expect(pageTitle, 'Không thấy tiêu đề trang').toBeVisible();
          if (title) await expect(pageTitle, `Tiêu đề trang không có "${title}"`).toContainText(title, { ignoreCase: true });
        }

        // Dropdown "Cửa hàng" trên trang (nếu có) chỉ được liệt kê cửa hàng được phân
        const storeSelect = page.locator('amf-select[label="Cửa Hàng" i]');
        if (stores.length && (await storeSelect.count())) {
          compareStores(`Dropdown "Cửa hàng" ở ${path}`, await readSelectOptions(page, storeSelect.first()), stores);
        }
      });
    }

    for (const f of buttonFeatures) {
      const allowed = isAllowed(f, role.key);
      const b = f.button!;
      const press = b.press ?? !DANGER.test(b.name);
      test(`${allowed ? 'Thấy + bấm được' : 'Không thấy'} nút: ${f.group} › ${f.name}`, async () => {
        test.setTimeout(120_000); // dò menu nhiều dòng / nhiều trang
        const where = `"${b.name}" (${b.path}${b.detail ? ` → ${b.detail}` : ''}${b.steps ? ` → ${b.steps.join(' → ')}` : ''})`;
        // Không mở được trang / chi tiết / bước trung gian: không quyền → đúng (không thể thấy nút); có quyền → lỗi
        const blocked = (reason: string) => {
          expect(allowed, `Vai trò ${role.label} CÓ quyền nhưng ${reason} → không kiểm tra được nút ${where}`).toBe(false);
        };

        await page.goto(b.path);
        await waitIdle(page);
        if (/\/errors\//.test(page.url())) return blocked(`không vào được ${b.path}`);

        if (b.detail) {
          const detail = await openDetail(page, b.detail);
          if (!detail.ok) {
            if (allowed && detail.dataDependent) {
              test.skip(true, `Không kiểm tra được nút ${where} — không có dòng dữ liệu để mở chi tiết (${b.detail}), ${detail.hint}`);
            }
            return blocked(`không mở được chi tiết (${b.detail})`);
          }
        }
        for (const step of b.steps ?? []) {
          if (!(await clickStep(page, step))) return blocked(`không bấm được bước "${step}"`);
        }

        const found = await findButton(page, b, allowed);
        if (!allowed) {
          expect(found.button, `KHÔNG được thấy nút ${where}`).toBeNull();
          return;
        }
        if (!found.button && found.dataDependent) {
          test.skip(true, `Không kiểm tra được nút ${where} — ${found.hint}`);
        }
        expect(found.button, `Phải thấy nút ${where}${found.hint ? ` — ${found.hint}` : ''}`).not.toBeNull();
        const button = found.button!;

        // Bấm được: hiện, không bị khoá, nhận được click (trial = kiểm tra mà KHÔNG bấm thật)
        if (b.disabledOk) return; // nút chỉ bật khi đã nhập / sửa dữ liệu → chỉ kiểm tra có hiện
        await expect(button, `Nút ${where} bị khoá (disabled)`).not.toBeDisabled();
        await waitIdle(page);
        await button.click({ trial: true, timeout: 8_000 }).catch((e) => {
          throw new Error(`Nút ${where} không bấm được (bị che / không nhận click): ${e.message.split('\n')[0]}`);
        });
        if (press) await pressAndCheck(page, button, where, b.expectUrl);
      });
    }

    const storeList = pageFeatures.find((f) => f.page!.path === '/store-manager') as Feature;
    if (storeList && isAllowed(storeList, role.key)) {
      test('Danh sách cửa hàng chỉ có cửa hàng được phân', async () => {
        test.skip(!stores.length, `Chưa điền ${role.env}_STORES nên không kiểm tra phạm vi cửa hàng`);
        await page.goto('/store-manager');
        await waitIdle(page);
        // cột "Tên cửa hàng" = cột thứ 2 của bảng dữ liệu
        const names = (await page.locator('table tbody tr td:nth-child(2)').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        compareStores('Danh sách cửa hàng', names, stores);
      });
    }
  });
}
