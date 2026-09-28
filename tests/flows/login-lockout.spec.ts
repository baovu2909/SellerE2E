import fs from 'fs';
import { expect, test } from '@playwright/test';
import { LoginPage } from '../../pages/login.page';

const USERNAME = process.env.LOCK_TEST_USERNAME ?? '';
const CORRECT_PASSWORD = process.env.LOCK_TEST_PASSWORD ?? '';
const MAX = Number(process.env.LOCK_MAX_ATTEMPTS ?? 5);
const LOCK_RE = new RegExp(process.env.LOCK_MESSAGE ?? 'khoá|khóa|locked|blocked|tạm dừng|vô hiệu', 'i');

test.use({ storageState: { cookies: [], origins: [] } });

test(`đăng nhập sai ${MAX} lần thì tài khoản bị khoá`, async ({ page }, testInfo) => {
  if (!USERNAME) throw new Error('Chưa có LOCK_TEST_USERNAME (tài khoản dùng để test khoá). Điền vào env/.env.<ENV> hoặc ô trên trang điều khiển.');
  if (USERNAME.toLowerCase() === (process.env.SELLER_USERNAME ?? '').toLowerCase()) {
    throw new Error('LOCK_TEST_USERNAME trùng SELLER_USERNAME — test sẽ khoá tài khoản chính. Hãy dùng tài khoản khác.');
  }

  const loginPage = new LoginPage(page);
  await loginPage.goto();

  const history: string[] = [];
  const snap = async (name: string) => {
    const file = testInfo.outputPath(`${String(history.length).padStart(2, '0')}-${name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`);
    await page.screenshot({ path: file });
    await testInfo.attach(name, { path: file, contentType: 'image/png' });
    fs.rmSync(file, { force: true });
  };

  let lockedAt = 0;
  for (let i = 1; i <= MAX; i++) {
    await test.step(`Lần ${i}: nhập sai mật khẩu`, async () => {
      const { status, message } = await loginPage.attempt(USERNAME, `Sai-${i}-${Date.now()}`);
      history.push(`Lần ${i} [HTTP ${status}]: ${message || '(không có thông báo)'}`);
      await snap(`Lần ${i} sai mật khẩu`);

      expect(message, `Lần ${i}: không thấy thông báo lỗi nào trên trang`).not.toBe('');
      if (LOCK_RE.test(message)) lockedAt = i;
      expect(lockedAt === 0 || i === MAX, `Bị khoá sớm ở lần ${i} (mong đợi sau ${MAX} lần).\n${history.join('\n')}`).toBe(true);
    });
  }

  await test.step(CORRECT_PASSWORD ? 'Thử lại bằng mật khẩu ĐÚNG — phải vẫn bị chặn' : 'Thử lại lần nữa — phải báo bị khoá', async () => {
    const { status, message } = await loginPage.attempt(USERNAME, CORRECT_PASSWORD || `Sai-extra-${Date.now()}`);
    history.push(`Sau khi khoá [HTTP ${status}]: ${message || '(không có thông báo)'}`);
    await snap('Sau khi khoá');

    expect(page.url(), `Đăng nhập được dù đã sai ${MAX} lần — tài khoản KHÔNG bị khoá.\n${history.join('\n')}`).toMatch(/\/auth\/login/);
    expect(
      message,
      `Sai ${MAX} lần nhưng không thấy thông báo khoá tài khoản.\n${history.join('\n')}`,
    ).toMatch(LOCK_RE);
  });

  console.log(`✔ Tài khoản ${USERNAME} bị khoá sau ${MAX} lần sai.\n  ${history.join('\n  ')}`);
});
