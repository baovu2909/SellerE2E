import { expect, Locator, Page } from '@playwright/test';
import { autoDismissSecurityPopup } from './common';

export interface StoreInfo {
  storeName: string;
  sellLocationCode: string;
  address: string;
}

export class CreateStorePage {
  readonly modal: Locator;
  readonly title: Locator;

  constructor(private readonly page: Page) {
    this.modal = page.locator('app-create-store');
    this.title = this.modal.getByRole('heading', { name: 'Thêm Cửa Hàng' });
  }

  async goto(): Promise<void> {
    await autoDismissSecurityPopup(this.page);
    await this.page.goto('/store-manager');
  }

  async create(info: StoreInfo): Promise<{ province: string; ward: string }> {
    await this.page.getByRole('button', { name: 'Thêm Cửa Hàng' }).click();
    await expect(this.title).toBeVisible();

    await this.input('Tên Cửa Hàng').fill(info.storeName);
    await this.input('Mã Địa Điểm Kinh Doanh').fill(info.sellLocationCode);
    await this.input('Địa Chỉ Địa Điểm Kinh Doanh').fill(info.address);

    const province = await this.pickRandom('Chọn tỉnh/thành phố');
    const wardButton = this.modal.getByRole('button', { name: 'Chọn phường/xã' });
    await expect(wardButton).toBeEnabled();
    const ward = await this.pickRandom('Chọn phường/xã');

    await this.modal.getByRole('button', { name: 'Tạo Cửa Hàng' }).click();

    await expect(this.title, `Tạo "${info.storeName}" thất bại`).toBeHidden({ timeout: 20_000 });
    return { province, ward };
  }

  private input(label: string): Locator {
    return this.modal.locator('amf-input').filter({ hasText: label }).locator('input');
  }

  private async pickRandom(placeholder: string): Promise<string> {
    await this.modal.getByRole('button', { name: placeholder }).click();

    const panel = this.page
      .locator('div')
      .filter({ has: this.page.getByPlaceholder('Tìm kiếm...') })
      .filter({ has: this.page.getByRole('button') })
      .last();
    const options = panel.getByRole('button').filter({ hasNotText: placeholder });
    await expect(options.first()).toBeVisible();

    const count = await options.count();
    const option = options.nth(Math.floor(Math.random() * count));
    const text = (await option.innerText()).trim();
    await option.click();
    return text;
  }
}
