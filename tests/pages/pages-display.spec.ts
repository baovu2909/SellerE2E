import { Request, Response } from '@playwright/test';
import { expect, test } from '../shared-page';
import { SELLER_PAGES } from './seller-pages';

for (const [section, pages] of Object.entries(SELLER_PAGES)) {
  test.describe(section, () => {
    for (const { path, title } of pages) {
      test(`${path}${title ? ` — ${title}` : ''}`, async ({ page }) => {
        const jsErrors: string[] = [];
        const apiErrors: string[] = [];
        const onPageError = (e: Error) => jsErrors.push(e.message);
        const onResponse = (r: Response) => {
          const req: Request = r.request();
          if (['xhr', 'fetch'].includes(req.resourceType()) && r.status() >= 500) {
            apiErrors.push(`${r.status()} ${req.method()} ${r.url()}`);
          }
        };
        page.on('pageerror', onPageError);
        page.on('response', onResponse);
        try {
          await page.goto(path);
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

          await expect(page, 'Bị chuyển về trang đăng nhập — phiên hết hạn?').not.toHaveURL(/\/auth\//);
          await expect(page, 'Bị chuyển sang trang lỗi / không có quyền').not.toHaveURL(/\/errors\/|approval-required/);

          const pageTitle = page.locator('app-page-title');
          await expect(pageTitle, 'Không thấy tiêu đề trang (breadcrumb)').toBeVisible();
          if (title) {
            await expect(pageTitle, `Tiêu đề trang không có "${title}"`).toContainText(title, { ignoreCase: true });
          }

          expect.soft(jsErrors, 'Có lỗi JavaScript trên trang').toEqual([]);
          expect.soft(apiErrors, 'Có API trả lỗi 5xx').toEqual([]);
        } finally {
          page.off('pageerror', onPageError);
          page.off('response', onResponse);
        }
      });
    }
  });
}
