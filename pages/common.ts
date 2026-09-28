import { Page } from '@playwright/test';

const handled = new WeakSet<Page>();

export async function autoDismissSecurityPopup(page: Page): Promise<void> {
  if (handled.has(page)) return;
  handled.add(page);
  await page.addLocatorHandler(page.getByText('Khuyến Nghị Bảo Mật'), async () => {
    await page.getByRole('button', { name: 'Huỷ' }).click();
  });
}
