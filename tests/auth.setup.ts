import { test as setup } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';
import { LoginPage } from '../pages/login.page';

setup('đăng nhập', async ({ page }) => {
  const username = process.env.SELLER_USERNAME;
  const password = process.env.SELLER_PASSWORD;

  if (!username || !password) {
    throw new Error(
      `Thiếu SELLER_USERNAME / SELLER_PASSWORD. Điền vào env/.env.${process.env.ENV ?? 'dev'} (xem env/.env.example).`,
    );
  }

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(username, password);

  await page.context().storageState({ path: STORAGE_STATE });
});
