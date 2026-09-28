import { test } from '@playwright/test';
import { autoDismissSecurityPopup } from '../../pages/common';
const PAGES = ['/sales','/error-notices','/error-record','/employees','/permissions','/store-manager','/orders','/categories','/product',
  '/inventory/warehouse','/inventory/export-book','/inventory/receipt','/inventory/inventory-audit','/inventory/transfer','/inventory/inventory-ledger',
  '/promotion','/promotion-code','/customer-debt','/income-expense','/customers','/reports','/cash','/profit-and-loss-report'];
test.setTimeout(600_000);
test('explore', async ({ page }) => {
  await autoDismissSecurityPopup(page);
  const vis = () => page.locator('button, a[role=button], [role=menuitem]').evaluateAll(els => els
    .filter(e => (e as HTMLElement).offsetParent !== null && !e.closest('app-navbar, app-header, header'))
    .map(e => ((e.textContent || '').replace(/\s+/g, ' ').trim() || e.getAttribute('title') || e.getAttribute('aria-label') || '').trim()).filter(Boolean));
  for (const url of PAGES) {
    await page.goto(url); await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const top = [...new Set(await vis())];
    const rows = await page.locator('table tbody tr').count();
    let menu: string[] = [];
    const dots = page.locator('table tbody tr').first().locator('button').last();
    if (rows && await dots.count()) {
      const before = new Set(await vis());
      await dots.click().catch(() => {}); await page.waitForTimeout(600);
      menu = (await vis()).filter(t => !before.has(t));
      await page.keyboard.press('Escape'); await page.mouse.click(1580, 890);
    }
    console.log(`## ${url} | rows=${rows}\n  TOP: ${top.slice(0, 25).join(' • ')}\n  MENU: ${menu.join(' • ')}`);
  }
});
