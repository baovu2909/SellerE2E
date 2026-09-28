import { expect, Page } from '@playwright/test';

export interface LoginAttempt {
  status: number;
  message: string;
}

export class LoginPage {
  constructor(private readonly page: Page) {}

  readonly errorBox = () => this.page.locator('div.bg-red-50').filter({ has: this.page.locator('span') });

  async goto(): Promise<void> {
    await this.page.goto('/auth/login');
  }

  async login(username: string, password: string, hint = ''): Promise<void> {
    await this.fill(username, password);
    await this.page.getByRole('button', { name: 'Đăng Nhập' }).click();

    const left = this.page.waitForURL((url) => !/\/auth\/login/.test(url.pathname), { timeout: 30_000 }).then(() => 'ok' as const);
    const failed = this.errorBox().waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'error' as const);
    const result = await Promise.race([left, failed]).catch(() => 'timeout' as const);

    if (result === 'error') {
      const message = (await this.errorBox().innerText()).trim();
      throw new Error(`Đăng nhập thất bại với tài khoản "${username}": ${message}${hint ? `\n→ ${hint}` : ''}`);
    }
    if (result === 'timeout') {
      throw new Error(`Đăng nhập tài khoản "${username}" không phản hồi sau 30 giây (vẫn ở trang đăng nhập)${hint ? `\n→ ${hint}` : ''}`);
    }
    await expect(this.page).not.toHaveURL(/\/auth\/login/);
  }

  async attempt(username: string, password: string): Promise<LoginAttempt> {
    await this.fill(username, password);
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => /\/auth\/login/i.test(r.url()) && r.request().method() === 'POST'),
      this.page.getByRole('button', { name: 'Đăng Nhập' }).click(),
    ]);

    const box = this.errorBox();
    await box.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    const message = (await box.isVisible()) ? (await box.innerText()).trim() : '';
    return { status: response.status(), message };
  }

  private async fill(username: string, password: string): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Nhập tài khoản của bạn' }).fill(username);
    await this.page.locator('input[type="password"]').fill(password);
  }
}
