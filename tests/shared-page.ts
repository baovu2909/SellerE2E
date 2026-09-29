import { BrowserContext, Page, test as base } from '@playwright/test';
import { autoDismissSecurityPopup } from '../pages/common';
import { watchApiErrors } from './api-errors';

/**
 * `test` dùng CHUNG 1 cửa sổ trình duyệt cho mọi test trong cùng worker
 * (mặc định Playwright mở cửa sổ mới cho từng test → nhìn như tắt / bật liên tục).
 *
 * Ảnh màn hình + trace của từng test vẫn do Playwright tự làm theo playwright.config.ts
 * (Playwright tự theo dõi mọi context tạo từ fixture `browser`).
 * Lưu ý: dùng chung cookie / localStorage giữa các test → chỉ dùng cho test không phụ thuộc trạng thái sạch.
 *
 *   import { test, expect } from '../shared-page';
 */
export const test = base.extend<{}, { shared: { context: BrowserContext; page: Page } }>({
  shared: [
    async ({ browser }, use, workerInfo) => {
      const u = workerInfo.project.use;
      const context = await browser.newContext({
        baseURL: u.baseURL,
        storageState: u.storageState,
        viewport: u.viewport,
        locale: u.locale,
        timezoneId: u.timezoneId,
      });
      const page = await context.newPage();
      await autoDismissSecurityPopup(page);
      await use({ context, page });
      await context.close();
    },
    { scope: 'worker' },
  ],

  // mỗi test: ghi lại response lỗi của API (xem tests/api-errors.ts)
  page: async ({ shared }, use, testInfo) => {
    const stop = watchApiErrors(shared.page, testInfo);
    await use(shared.page);
    await stop();
  },
});

export { expect } from '@playwright/test';
