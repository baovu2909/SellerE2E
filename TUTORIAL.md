# Tutorial — các lệnh hay chạy

Mọi lệnh chạy trong terminal, tại thư mục `seller-e2e`.
Thay `dev` bằng `test` để chạy trên môi trường test.

---

## ⭐ Cách nhanh nhất: trang điều khiển

```powershell
npm run panel
```

Trình duyệt tự mở `http://localhost:4000`, trên đó có:

- **dev / test** (góc trên phải): chọn môi trường
- **Hiển thị**: bật/tắt *Hiện trình duyệt*, chọn *Tốc độ thao tác* (chậm vừa / rất chậm để dễ nhìn), và nút **Mở Playwright UI** để xem lại từng bước
- **Đăng nhập**, **Tạo cửa hàng** (nhập *Bắt đầu từ số* + *Số lượng*), **Chạy test**, **Khoá tài khoản sau 5 lần sai**, **Mở báo cáo**
- Bên phải có 3 tab:
  - **Log**: xem kết quả trực tiếp, có nút **Dừng**
  - **Thành công**: test pass kèm ảnh chụp từng bước / màn hình cuối
  - **Lỗi**: test fail kèm thông báo lỗi, ảnh, video, trace (bấm ảnh để phóng to)

Tạo cửa hàng xong, ô *Bắt đầu từ số* tự tăng lên số kế tiếp để lần sau không bị trùng tên.
Tắt trang điều khiển: bấm `Ctrl+C` trong terminal.

Các mục bên dưới là lệnh gõ tay, cho ai thích dùng terminal.

---

## 0. Chuẩn bị (chỉ làm 1 lần)

```powershell
npm install
npx playwright install chromium
```

Điền tài khoản vào `env/.env.dev` (và `env/.env.test`):

```
SELLER_USERNAME=tai_khoan
SELLER_PASSWORD=mat_khau
```

---

## 1. Đăng nhập

```powershell
npm run login:dev
```

Đăng nhập và lưu phiên vào `.auth/dev.json`. Các lệnh khác tự đăng nhập trước khi chạy, nên thường không cần gọi lệnh này riêng.

**Nhiều tài khoản (trên trang điều khiển):** mục **Đăng nhập** → nhập *Tên đăng nhập* + *Mật khẩu* → **Lưu tài khoản**. Tài khoản được lưu lại (riêng cho dev / test), lần sau chỉ cần bấm vào tên để đổi — mọi lệnh trên trang điều khiển sẽ dùng tài khoản đang chọn (tên hiện ở góc trên). Chọn *Theo file env* để quay về `SELLER_USERNAME` trong `env/.env.<môi trường>`. Danh sách lưu ở `env/accounts.json` (không commit). Lệnh gõ tay trong terminal vẫn dùng file env.

---

## 2. Tạo cửa hàng hàng loạt

```powershell
# Mặc định: tạo 20 cửa hàng, "Emolite Shop 1" → "Emolite Shop 20"
npm run create-stores:dev

# Tạo 10 cửa hàng, bắt đầu từ số 21 → "Emolite Shop 21" → "Emolite Shop 30"
npx cross-env STORE_START=21 STORE_COUNT=10 npm run create-stores:dev

# Tạo 1 cái để thử
npx cross-env STORE_START=99 STORE_COUNT=1 npm run create-stores:dev

# Thêm -- --headed ở cuối để xem trình duyệt thao tác
npx cross-env STORE_START=21 STORE_COUNT=10 npm run create-stores:dev -- --headed
```

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `STORE_START` | Số thứ tự bắt đầu trong tên cửa hàng | `1` |
| `STORE_COUNT` | Số cửa hàng cần tạo | `20` |

Dữ liệu mỗi cửa hàng:
- **Tên:** `Emolite Shop <số>`
- **Mã địa điểm KD:** 5 chữ số ngẫu nhiên
- **Địa chỉ:** số nhà + tên đường ngẫu nhiên
- **Tỉnh/Thành phố, Phường/Xã:** chọn ngẫu nhiên

> ⚠️ Lệnh không kiểm tra tên đã tồn tại chưa. Chạy lại cùng `STORE_START` sẽ tạo cửa hàng trùng tên, nên nhớ tăng `STORE_START` sau mỗi lần chạy.

Muốn đổi tên hoặc giá trị mặc định: sửa [tests/data/create-stores.spec.ts](tests/data/create-stores.spec.ts).

---

## 3. Test khoá tài khoản sau 5 lần sai

> ⚠️ Test này **khoá thật** tài khoản → dùng tài khoản riêng, **không** dùng `SELLER_USERNAME` (test sẽ tự chặn nếu trùng).

Điền vào `env/.env.dev` (hoặc nhập thẳng trên trang điều khiển):

```
LOCK_TEST_USERNAME=tai_khoan_de_test_khoa
LOCK_TEST_PASSWORD=mat_khau_dung   # tuỳ chọn: sau khi khoá, thử mật khẩu đúng phải vẫn bị chặn
```

```powershell
npm run lockout:dev
```

- **Pass**: lần 1–4 báo sai mật khẩu, sau lần 5 thấy thông báo khoá (chứa "khoá/khóa/locked/…").
- **Fail**: bị khoá sớm hơn, hoặc sai 5 lần vẫn chỉ báo "Sai tên đăng nhập hoặc mật khẩu!". Lỗi liệt kê thông báo từng lần.
- Mỗi lần thử đều chụp ảnh → xem ở tab **Thành công** / **Lỗi**.
- Đổi số lần hoặc câu thông báo: biến `LOCK_MAX_ATTEMPTS` (mặc định 5), `LOCK_MESSAGE` (regex).
- Test xong nhớ **mở khoá** tài khoản đó để lần sau test lại.

---

## 4. Test theo vai trò

Quyền của từng vai trò lưu ở **một file duy nhất**: [tests/roles/permission-matrix.ts](tests/roles/permission-matrix.ts) (chép từ sheet *Tổng hợp* của USER_ROLE). Quyền thay đổi → chỉ sửa file này.

Điền tài khoản từng vai trò vào `env/.env.dev`:

```
ROLE_STORE_MANAGER_USERNAME=...
ROLE_STORE_MANAGER_PASSWORD=...
ROLE_STORE_MANAGER_STORES=Emolite Shop 1,Emolite Shop 2   # cửa hàng tài khoản được phân (trống = không kiểm tra)
```

(Owner, Quản lý cửa hàng, Quản lý kinh doanh, Quản lý nhân sự, Thủ kho, Bán hàng, Kế toán — vai trò chưa điền sẽ bị bỏ qua.)

```powershell
npm run roles:dev                                   # mọi vai trò đã điền tài khoản
npx cross-env ROLES_ONLY=cashier,accountant npm run roles:dev   # chỉ vài vai trò
```

Mỗi vai trò kiểm tra (chỉ xem, không tạo / sửa / xoá):
- **Menu sidebar**: thấy đúng mục được phép, không thấy mục không được phép
- **Từng trang**: được phép → mở bình thường; không phép → phải bị chặn (`/errors/403`)
- **Nút theo quyền** (Thêm cửa hàng, Tạo phiếu nhập kho, …): hiện / ẩn đúng
- **Cửa hàng được phân**: danh sách cửa hàng và mọi dropdown "Cửa hàng" chỉ có đúng các cửa hàng trong `_STORES`

---

## 4b. Kiểm tra doanh thu

So **Tổng doanh thu** (trang Báo cáo doanh thu) với tổng cộng dồn của từng phần trong cùng khoảng ngày: theo thời gian, phương thức thanh toán, cửa hàng, kênh bán, nhân viên (cả biểu đồ lẫn bảng chi tiết). Chỉ xem, không tạo / sửa / xoá. File test: [tests/reports/revenue-sync.spec.ts](tests/reports/revenue-sync.spec.ts).

Trên trang điều khiển: menu **Doanh thu** → chọn khoảng ngày trên lịch (trống = 1 tháng gần nhất) → **Chạy kiểm tra doanh thu**.

```powershell
npm run revenue:dev                                                        # 1 tháng gần nhất
npx cross-env REVENUE_FROM=2026-01-01 REVENUE_TO=2026-09-28 npm run revenue:dev   # khoảng ngày tuỳ chọn
```

---

## 5. Chạy test

```powershell
npm run test:dev            # chạy toàn bộ test (ẩn trình duyệt)
npm run test:dev:headed     # chạy và hiện trình duyệt
npm run ui:dev              # mở Playwright UI, chọn từng test, xem từng bước
```

Các lệnh test **không** chạy phần tạo dữ liệu (`tests/data/`) và luồng khoá tài khoản (`tests/flows/`), nên không tạo / sửa / xoá gì.

**Kiểm tra hiển thị mọi trang** ([tests/pages/pages-display.spec.ts](tests/pages/pages-display.spec.ts)): mở lần lượt ~37 trang Seller (theo menu sidebar), mỗi trang đạt khi:
- không bị chuyển về trang đăng nhập / trang lỗi (404, 403, chờ duyệt)
- tiêu đề trang (breadcrumb) có đúng tên trang
- không có lỗi JavaScript, không có API trả lỗi 5xx

Thêm / bớt trang: sửa danh sách trong [tests/pages/seller-pages.ts](tests/pages/seller-pages.ts) (mỗi dòng: `path` + `title`).

---

## 6. Xem kết quả / lỗi

```powershell
npm run report:dev
```

Mở báo cáo HTML của lần chạy gần nhất, có ảnh chụp, video và trace khi test lỗi.

**Ảnh của mọi lần chạy** (báo cáo trên chỉ giữ lần gần nhất) được lưu riêng, tách đạt / lỗi:

```
screenshots/dev/success/2026-09-28_102230/Doanh thu - 1. Tổng quan …/01-Tổng quan.png, ket-qua.txt
screenshots/dev/error/2026-09-28_102230/Doanh thu - 4. Tab Cửa Hàng/01-Tab Cửa Hàng.png, ket-qua.txt, loi.txt
```

Tự xoá bản cũ hơn 14 ngày (đổi bằng `SCREENSHOT_KEEP_DAYS` trong env, `0` = giữ mãi). Thư mục `screenshots/` không commit.

---

## 7. Ghi thao tác để sinh code

```powershell
npm run record:dev
```

Lệnh đăng nhập sẵn rồi mở trình duyệt. Bạn thao tác trên web, Playwright tự sinh code, rồi copy code đó vào file `tests/*.spec.ts`.

---

## 8. Thêm lệnh tạo dữ liệu mới (sản phẩm, nhân viên, …)

Làm theo khuôn của lệnh tạo cửa hàng:

1. **Page object** trong `pages/`, ví dụ `pages/create-product.page.ts`: chứa các bước bấm/điền trên màn hình.
   Tham khảo [pages/create-store.page.ts](pages/create-store.page.ts).
2. **Spec** trong `tests/data/`, ví dụ `tests/data/create-products.spec.ts`: chứa vòng lặp và dữ liệu.
3. **Nút trên trang điều khiển** (nếu muốn): thêm 1 mục trong `ACTIONS` ở [panel/server.js](panel/server.js) + 1 khung `card` có `data-run="<tên>"` trong [panel/index.html](panel/index.html).
4. **Lệnh** trong `package.json` → `scripts`:
   ```json
   "create-products:dev": "cross-env ENV=dev playwright test --project=data tests/data/create-products.spec.ts"
   ```
5. Chạy: `npm run create-products:dev`

---

## Lỗi hay gặp

| Lỗi | Cách xử lý |
|---|---|
| `Thiếu SELLER_USERNAME / SELLER_PASSWORD` | Chưa điền tài khoản trong `env/.env.dev` |
| `strict mode violation: ... resolved to 2 elements` | Selector khớp nhiều phần tử, cần chọn cụ thể hơn (vd `getByRole('textbox', { name })`) |
| Click bị chặn bởi `p-dialog-mask` | Có popup che màn hình. Dùng `page.addLocatorHandler(...)` để tự đóng, xem `create-store.page.ts` |
| `2 did not run` | Bước đăng nhập (setup) lỗi nên các test sau bị bỏ qua. Xem lỗi của bước setup |
