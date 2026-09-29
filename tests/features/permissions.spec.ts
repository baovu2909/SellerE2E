import { Page, Response } from '@playwright/test';
import { expect, test } from '../shared-page';
import { ROLES } from '../roles/permission-matrix';
import { PERMISSION_PAGE, expectedOnPage, findPageRow } from '../roles/permission-page';
import { Steps, norm, waitIdle } from './helpers';

/**
 * Tab PHÂN QUYỀN (/permissions) — chỉ xem, không sửa quyền.
 *
 *   Mỗi vai trò: chọn vai trò → "Mở tất cả" → đọc từng nhóm / dòng / chấm (đậm = có quyền) rồi so 2 lớp:
 *     - Màn hình khớp dữ liệu hệ thống (API policies): chấm, "x/y quyền" từng nhóm, "Đã cấp x/y", "x/y chức năng" ở thẻ vai trò
 *     - Hệ thống khớp matrix (permission-matrix.ts qua bảng nối permission-page.ts)
 *   Bộ lọc: ô "Nhập Quyền Hoặc Chức Năng" (PERMISSION_SEARCH, mặc định "khuyến mãi"), từ khoá không có, xoá lọc
 *   Mở tất cả / Đóng tất cả + mở từng nhóm
 */

const SEARCH = (process.env.PERMISSION_SEARCH ?? '').trim() || 'khuyến mãi';
const PAGE_ROLES = ROLES.filter((r) => r.key !== 'owner');

interface UiGroup { title: string; granted: number; total: number; modules: { name: string; granted: boolean }[] }

const isPolicies = (r: Response) => r.url().includes('/api/user/policies') && r.ok();

async function openPage(page: Page) {
  const pol = page.waitForResponse((r) => isPolicies(r) && !new URL(r.url()).searchParams.toString(), { timeout: 20_000 }).catch(() => null);
  const roles = page.waitForResponse((r) => r.url().includes('/api/user/roles') && r.ok(), { timeout: 20_000 }).catch(() => null);
  await page.goto('/permissions');
  await waitIdle(page);
  await expect(page, 'Không vào được trang Phân quyền (bị chặn quyền / hết phiên?)').not.toHaveURL(/\/errors\/|\/auth\//);
  await expect(page.getByText('Quản Lý Phân Quyền')).toBeVisible();
  const policies: any[] = (await (await pol)?.json().catch(() => null))?.data ?? [];
  const roleList: any[] = (await (await roles)?.json().catch(() => null))?.data ?? [];
  return { policies, roleList };
}

const expandBtn = (page: Page) => page.getByRole('button', { name: /Mở tất cả|Đóng tất cả/ });

async function expandAll(page: Page) {
  if (/Mở tất cả/.test((await expandBtn(page).textContent()) ?? '')) await expandBtn(page).click();
  await page.waitForTimeout(300);
}

/** Đọc các nhóm quyền đang hiện: tiêu đề, "x/y quyền", các dòng + chấm (đậm #3F3F46 = có quyền) */
function readGroups(page: Page): Promise<UiGroup[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.table-scroll .space-y-4 > div')]
      .filter((g) => g.querySelector('span.font-semibold'))
      .map((g) => {
        const header = g.firstElementChild as HTMLElement;
        const m = (header.innerText || '').match(/(\d+)\s*\/\s*(\d+)\s*quyền/);
        return {
          title: (header.querySelector('span.font-semibold')?.textContent ?? '').trim(),
          granted: Number(m?.[1] ?? NaN),
          total: Number(m?.[2] ?? NaN),
          modules: [...g.querySelectorAll('.grid > div')].map((d) => ({
            name: (d.textContent ?? '').replace(/\s+/g, ' ').trim(),
            granted: (d.querySelector('span')?.className ?? '').includes('3F3F46'),
          })),
        };
      }),
  );
}

const roleCard = (page: Page, label: string) =>
  // (?=\s|$) thay \b vì \b không nhận chữ có dấu ("Nhân Sự")
  page.locator('.space-y-3 > div').filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i') }).first();

test.describe('Phân quyền', () => {
  for (const role of PAGE_ROLES) {
    test(`Vai trò: ${role.label} — đối chiếu matrix`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const steps = new Steps(page, testInfo);
      try {
        const { policies, roleList } = await openPage(page);
        const apiRole = roleList.find((r) => r.name === role.code);
        const policy = policies.find((p) => p.roleKey === role.code);
        expect(apiRole, `Hệ thống không có vai trò "${role.code}" (${role.label})`).toBeTruthy();
        expect(policy, `Hệ thống không có policy cho vai trò "${role.code}"`).toBeTruthy();
        const label = apiRole.displayName || apiRole.name;
        steps.note(`Vai trò "${label}" (${role.code}) — matrix: ${role.label}`);

        // Thẻ vai trò: "x/y chức năng được cấp quyền" = số nhóm có ít nhất 1 dòng có quyền / tổng nhóm
        const card = roleCard(page, label);
        await expect(card, `Không thấy vai trò "${label}" trong danh sách bên trái`).toBeVisible();
        const groupsApi: any[] = policy.permissionGroup ?? [];
        const needCard = `${groupsApi.filter((g) => g.resources.some((r: any) => r.permissions?.length)).length}/${groupsApi.length}`;
        const cardText = ((await card.innerText()) ?? '').replace(/\s+/g, ' ');
        steps.check(cardText.includes(`${needCard} chức năng`), `Thẻ vai trò hiện "${needCard} chức năng được cấp quyền"`, cardText);

        await card.click();
        await expandAll(page);
        const ui = await readGroups(page);
        await steps.shot(`Phân quyền — ${label}`);

        // 1) Màn hình khớp dữ liệu hệ thống
        const allModules = ui.flatMap((g) => g.modules);
        const header = ((await page.getByText(/Đã cấp \d+\/\d+ quyền/).textContent()) ?? '').trim();
        const needHeader = `Đã cấp ${allModules.filter((m) => m.granted).length}/${allModules.length} quyền`;
        steps.check(header === needHeader, `"Đã cấp x/y quyền" khớp số chấm đậm trên màn hình`, `đang "${header}", đếm được "${needHeader}"`);
        steps.check(ui.length === groupsApi.length, `Hiện đủ ${groupsApi.length} nhóm quyền`, `trên màn hình ${ui.length}`);
        const uiWrong: string[] = [];
        for (const g of groupsApi) {
          const ug = ui.find((x) => norm(x.title) === norm(g.groupName));
          if (!ug) { uiWrong.push(`thiếu nhóm ${g.groupName}`); continue; }
          const granted = ug.modules.filter((m) => m.granted).length;
          if (ug.granted !== granted || ug.total !== ug.modules.length) uiWrong.push(`${g.groupName}: ghi ${ug.granted}/${ug.total} nhưng đếm được ${granted}/${ug.modules.length}`);
          for (const r of g.resources) {
            const um = ug.modules.find((m) => norm(m.name) === norm(r.resource));
            const has = Boolean(r.permissions?.length);
            if (!um) uiWrong.push(`${g.groupName} › ${r.resource}: không hiện`);
            else if (um.granted !== has) uiWrong.push(`${g.groupName} › ${r.resource}: màn hình ${um.granted ? 'CÓ' : 'KHÔNG'} quyền, hệ thống ${has ? 'CÓ' : 'KHÔNG'}`);
          }
        }
        steps.check(uiWrong.length === 0, 'Màn hình khớp dữ liệu hệ thống (chấm, số đếm từng nhóm)', uiWrong.slice(0, 8).join('; '));

        // 2) Hệ thống khớp matrix
        const diff: string[] = [];
        const unmapped: string[] = [];
        for (const g of groupsApi) {
          for (const r of g.resources) {
            const row = findPageRow(g.groupName, r.resource);
            if (!row) { unmapped.push(`${g.groupName} › ${r.resource}`); continue; }
            const exp = expectedOnPage(row, role.key);
            if (exp === null) continue;
            const has = Boolean(r.permissions?.length);
            if (exp !== has) diff.push(`[${g.groupName}] ${r.resource}: trang ${has ? `CÓ quyền (${r.permissions.map((p: any) => p.name).join('/')})` : 'KHÔNG có quyền'}, matrix ${exp ? 'CÓ' : 'KHÔNG'}`);
          }
        }
        if (diff.length) for (const d of diff) steps.check(false, `Lệch matrix — ${d}`);
        else steps.check(true, `Khớp matrix toàn bộ ${PERMISSION_PAGE.filter((r) => r.features.length).length} dòng đã nối`);
        if (unmapped.length) steps.warn(`${unmapped.length} dòng trên trang chưa có trong bảng nối (permission-page.ts)`, unmapped.join('; '));
      } finally {
        await steps.flush();
      }
    });
  }

  test('Dòng chưa có trong matrix', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      const empty = PERMISSION_PAGE.filter((r) => !r.features.length);
      if (!empty.length) steps.check(true, 'Mọi dòng trên trang Phân quyền đều đã nối với matrix');
      for (const r of empty) steps.warn(`[${r.group}] ${r.resource}`, 'matrix chưa có chức năng tương ứng — thêm vào permission-matrix.ts rồi nối trong permission-page.ts');
    } finally {
      await steps.flush();
    }
  });

  test('Bộ lọc', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const steps = new Steps(page, testInfo);
    try {
      await openPage(page);
      await expandAll(page);
      const full = await readGroups(page);
      const fullCount = full.flatMap((g) => g.modules).length;
      steps.note(`Không lọc: ${full.length} nhóm, ${fullCount} dòng`);
      const box = page.locator('amf-input[label="Nhập Quyền Hoặc Chức Năng"] input');

      const search = async (term: string) => {
        const res = page.waitForResponse((r) => isPolicies(r) && (new URL(r.url()).search.length > 0) === Boolean(term), { timeout: 15_000 }).catch(() => null);
        await box.fill(term);
        await page.getByRole('button', { name: 'Tìm Kiếm' }).click();
        await res;
        await waitIdle(page);
        await page.waitForTimeout(500);
        await expandAll(page);
        return readGroups(page);
      };

      // Có kết quả: mọi dòng hiện ra phải chứa từ khoá (hoặc thuộc nhóm có tên chứa từ khoá)
      const hit = await search(SEARCH);
      const rows = hit.flatMap((g) => g.modules.map((m) => ({ g: g.title, m: m.name })));
      const wrong = rows.filter((x) => !norm(x.m).includes(norm(SEARCH)) && !norm(x.g).includes(norm(SEARCH)));
      if (!rows.length) steps.warn(`Lọc "${SEARCH}": 0 kết quả`, 'không có quyền nào chứa từ khoá này để kiểm tra');
      else steps.check(wrong.length === 0, `Lọc "${SEARCH}": ${rows.length} dòng đều chứa từ khoá`, wrong.slice(0, 5).map((x) => `${x.g} › ${x.m}`).join('; '));
      steps.check(rows.length < fullCount, `Lọc "${SEARCH}" ra ít dòng hơn không lọc`, `${rows.length} / ${fullCount}`);
      await steps.shot(`Lọc ${SEARCH}`);

      // Không có kết quả
      const none = await search('zzz-khong-co-quyen-nay');
      const empty = await page.getByText('Không Tìm Thấy Quyền Phù Hợp').isVisible();
      steps.check(none.length === 0 && empty, 'Từ khoá không có → hiện "Không Tìm Thấy Quyền Phù Hợp"', `${none.length} nhóm`);
      await steps.shot('Lọc không có kết quả');

      // Xoá từ khoá → về đủ
      const back = await search('');
      const backCount = back.flatMap((g) => g.modules).length;
      steps.check(back.length === full.length && backCount === fullCount, 'Xoá từ khoá → hiện lại đủ', `${back.length} nhóm, ${backCount} dòng`);
    } finally {
      await steps.flush();
    }
  });

  test('Mở tất cả / Đóng tất cả', async ({ page }, testInfo) => {
    const steps = new Steps(page, testInfo);
    try {
      await openPage(page);
      const groups = page.locator('.table-scroll .space-y-4 > div').filter({ has: page.locator('span.font-semibold') });
      const openCount = () => groups.filter({ has: page.locator('.grid') }).count();
      const total = await groups.count();

      if (/Đóng tất cả/.test((await expandBtn(page).textContent()) ?? '')) await expandBtn(page).click();
      steps.check((await openCount()) === 0, `Ban đầu các nhóm đang đóng`, `${await openCount()}/${total} đang mở`);

      await expandBtn(page).click();
      await page.waitForTimeout(300);
      steps.check((await openCount()) === total, `"Mở tất cả" → mở cả ${total} nhóm`, `${await openCount()}/${total}`);
      steps.check(/Đóng tất cả/.test((await expandBtn(page).textContent()) ?? ''), 'Nút đổi thành "Đóng tất cả"');
      await steps.shot('Mở tất cả');

      await expandBtn(page).click();
      await page.waitForTimeout(300);
      steps.check((await openCount()) === 0, '"Đóng tất cả" → đóng hết', `${await openCount()}/${total} còn mở`);
      steps.check(/Mở tất cả/.test((await expandBtn(page).textContent()) ?? ''), 'Nút đổi lại thành "Mở tất cả"');

      // Bấm tiêu đề 1 nhóm → chỉ nhóm đó mở, bấm lần nữa → đóng
      await groups.first().locator('> div').first().click();
      await page.waitForTimeout(200);
      steps.check((await openCount()) === 1, 'Bấm 1 nhóm → chỉ nhóm đó mở', `${await openCount()} nhóm mở`);
      await groups.first().locator('> div').first().click();
      await page.waitForTimeout(200);
      steps.check((await openCount()) === 0, 'Bấm lại → nhóm đóng', `${await openCount()} nhóm mở`);
    } finally {
      await steps.flush();
    }
  });
});
