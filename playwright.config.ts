import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Chọn môi trường qua biến ENV (dev | test). Mặc định: dev.
 * Thông tin đăng nhập nằm trong env/.env.<ENV> (không commit).
 */
const ENV = (process.env.ENV ?? 'dev').toLowerCase();
dotenv.config({ path: path.resolve(__dirname, `env/.env.${ENV}`) });

const BASE_URLS: Record<string, string> = {
  dev: 'https://dev-seller.amfshopvn.vn',
  test: 'https://test-seller.amfshopvn.vn',
};

const baseURL = process.env.BASE_URL || BASE_URLS[ENV];
if (!baseURL) {
  throw new Error(`Môi trường "${ENV}" không hợp lệ. Dùng ENV=dev hoặc ENV=test.`);
}

/**
 * Mốc thời gian của lần chạy (vd tên mặc định "Test DM 280926-1530"). Đặt 1 lần ở đây → mọi worker dùng chung,
 * không bị đổi tên giữa các test khi worker khởi động lại.
 */
if (!process.env.RUN_STAMP) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  process.env.RUN_STAMP = `${p(d.getDate())}${p(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Chạy có hiện trình duyệt (trang điều khiển đặt PW_HEADED=1): mở Chrome toàn màn hình, trang co giãn theo cửa sổ
 * (viewport: null) để phóng to / kéo cửa sổ là trang giãn theo. Chạy ẩn giữ cố định 1600×900 cho kết quả ổn định.
 */
const HEADED = process.env.PW_HEADED === '1';
const DESKTOP = HEADED
  ? { ...devices['Desktop Chrome'], viewport: null, deviceScaleFactor: undefined, isMobile: undefined, hasTouch: undefined }
  : { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } };
const LAUNCH_ARGS = HEADED ? ['--start-maximized'] : [];

/** File lưu phiên đăng nhập theo từng môi trường — đăng nhập 1 lần, các test sau dùng lại. */
export const STORAGE_STATE = path.resolve(__dirname, `.auth/${ENV}.json`);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: `playwright-report/${ENV}`, open: 'never' }],
    // Trang điều khiển đọc file này để hiện tab Thành công / Lỗi
    ['json', { outputFile: `test-results/${ENV}/results.json` }],
    // Lưu ảnh mọi lần chạy vào screenshots/<env>/success|error/<ngày_giờ>/ (test-results/ bị xoá mỗi lần chạy)
    ['./reporters/screenshot-archive.ts'],
  ],
  outputDir: `test-results/${ENV}`,
  use: {
    // Dùng Google Chrome cài sẵn trên máy (không dùng Chromium tải kèm Playwright)
    channel: 'chrome',
    baseURL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: DESKTOP.viewport,
    // Chụp màn hình cuối mỗi test (cả thành công lẫn lỗi); video + trace chỉ giữ khi lỗi
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // SLOW_MO=300 → mỗi thao tác chậm 300ms, dễ theo dõi khi chạy --headed
    launchOptions: { slowMo: Number(process.env.SLOW_MO ?? 0), args: LAUNCH_ARGS },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...DESKTOP, storageState: STORAGE_STATE },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/, /tests[\\/]data[\\/]/, /tests[\\/]flows[\\/]/, /tests[\\/]roles[\\/]/, /tests[\\/]reports[\\/]/, /tests[\\/]features[\\/]/, /tests[\\/]_tmp[\\/]/],
    },
    {
      // Test theo từng tab (Danh mục, …) — CÓ tạo / sửa dữ liệu thật, chỉ chạy khi gọi đích danh --project=features
      name: 'features',
      use: { ...DESKTOP, storageState: STORAGE_STATE },
      dependencies: ['setup'],
      testMatch: /tests[\\/]features[\\/].*\.spec\.ts/,
    },
    {
      // Kiểm tra số liệu báo cáo (doanh thu, ...) — chỉ xem, dùng phiên đăng nhập chung
      name: 'reports',
      use: { ...DESKTOP, storageState: STORAGE_STATE },
      dependencies: ['setup'],
      testMatch: /tests[\\/]reports[\\/].*\.spec\.ts/,
    },
    {
      // Test theo vai trò — mỗi vai trò tự đăng nhập bằng tài khoản riêng (ROLE_*_USERNAME trong env)
      name: 'roles',
      use: {
        ...DESKTOP,
        // 7 vai trò chạy song song → xếp lệch cửa sổ theo worker để khi --headed không chồng khít lên nhau
        launchOptions: {
          slowMo: Number(process.env.SLOW_MO ?? 0),
          args: [...LAUNCH_ARGS, `--window-position=${Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 60},${Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 40}`],
        },
      },
      testMatch: /tests[\\/]roles[\\/].*\.spec\.ts/,
    },
    {
      // Luồng có tác dụng phụ (vd khoá tài khoản) — chỉ chạy khi gọi đích danh --project=flows
      name: 'flows',
      use: { ...DESKTOP },
      testMatch: /tests[\\/]flows[\\/].*\.spec\.ts/,
    },
    {
      // Tạo dữ liệu (cửa hàng, ...) — chỉ chạy khi gọi đích danh --project=data
      name: 'data',
      use: { ...DESKTOP, storageState: STORAGE_STATE },
      dependencies: ['setup'],
      testMatch: /tests[\\/]data[\\/].*\.spec\.ts/,
    },
  ],
});
