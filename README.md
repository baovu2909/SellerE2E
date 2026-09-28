# seller-e2e

Tự động mở trình duyệt, đăng nhập và thao tác trên **AMF Seller** bằng [Playwright](https://playwright.dev).

| Môi trường | URL |
|---|---|
| `dev`  | https://dev-seller.amfshopvn.vn |
| `test` | https://test-seller.amfshopvn.vn |

## 1. Cài đặt (1 lần)

```bash
npm install
npx playwright install chromium
```

## 2. Điền tài khoản

Mở `env/.env.dev` và `env/.env.test`, điền:

```
SELLER_USERNAME=tai_khoan_cua_ban
SELLER_PASSWORD=mat_khau_cua_ban
```

Các file này đã nằm trong `.gitignore`, không bị commit.

## 3. Lệnh hay dùng

| Lệnh | Tác dụng |
|---|---|
| `npm run test:dev` / `npm run test:test` | Chạy toàn bộ test (chạy ngầm, không hiện trình duyệt) |
| `npm run test:dev:headed` | Chạy test và **hiện trình duyệt** để xem thao tác |
| `npm run ui:dev` | Mở giao diện Playwright UI: chọn từng test, xem từng bước |
| `npm run record:dev` | Đăng nhập sẵn rồi mở **trình ghi thao tác** — bạn click trên web, Playwright tự sinh code |
| `npm run report:dev` | Mở báo cáo HTML của lần chạy gần nhất (ảnh chụp / video khi lỗi) |

Thay `dev` bằng `test` để chạy trên môi trường test.

👉 Danh sách lệnh đầy đủ (kèm lệnh tạo cửa hàng hàng loạt): xem [TUTORIAL.md](TUTORIAL.md).

## 4. Cách hoạt động

- `tests/auth.setup.ts` đăng nhập **1 lần** qua trang `/auth/login` và lưu phiên vào `.auth/<env>.json`.
  Mọi test khác dùng lại phiên này nên không phải đăng nhập lại.
- `pages/` chứa các "page object" (vd `LoginPage`) — gom selector của từng trang về 1 chỗ.
- `tests/*.spec.ts` là các kịch bản. Ví dụ `tests/smoke.spec.ts`.

## 5. Viết kịch bản mới

Cách nhanh nhất: `npm run record:dev`, thao tác trên trình duyệt vừa mở, copy code sinh ra vào một file mới
`tests/<ten>.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('tạo sản phẩm', async ({ page }) => {
  await page.goto('/products');
  // ... dán code từ trình ghi vào đây
});
```
