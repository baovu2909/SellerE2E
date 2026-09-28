import { expect, test } from '@playwright/test';

test.describe('Smoke', () => {
  test('vào trang Đơn Hàng', async ({ page }) => {
    // "/" là trang giới thiệu công khai (không có menu) → mở 1 trang bên trong hệ thống rồi bấm menu
    await page.goto('/profile/general');
    await expect(page, 'Bị chuyển về trang đăng nhập — phiên hết hạn?').not.toHaveURL(/\/auth\/login/);

    await page.locator('app-navbar a').filter({ hasText: /^\s*Đơn Hàng\s*$/i }).first().click();
    await expect(page.getByText('Danh Sách Đơn Hàng')).toBeVisible();
  });

  test('vào trang Báo Cáo Doanh Thu', async ({ page }) => {
    await page.goto('/reports/revenue');
    await expect(page.getByText('Báo Cáo Doanh Thu').first()).toBeVisible();
  });
});
