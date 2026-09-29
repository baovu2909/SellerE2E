import { Locator, Page, TestInfo, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Tiện ích chung cho test theo từng tab (tests/features/*):
 *   - Steps: ghi từng dòng ✔ / ✘ + ảnh chụp từng bước, đính kèm vào test (xem trên trang điều khiển)
 */
export class Steps {
  private lines: string[] = [];
  private shotNo = 0;

  constructor(private page: Page, private info: TestInfo) {}

  note(text: string) {
    this.lines.push(text);
  }

  /** Ghi ✔ / ✘; sai thì báo lỗi (soft: vẫn chạy tiếp) */
  check(ok: boolean, label: string, detail = '') {
    this.lines.push(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
    expect.soft(ok, `${label}${detail ? ` — ${detail}` : ''}`).toBe(true);
  }

  /** Cảnh báo ⚠ (hiện màu vàng) — KHÔNG làm test lỗi, vd thao tác chính thành công nhưng việc phụ thất bại */
  warn(label: string, detail = '') {
    this.lines.push(`⚠ ${label}${detail ? ` — ${detail}` : ''}`);
    this.info.annotations.push({ type: 'warning', description: `${label}${detail ? ` — ${detail}` : ''}` });
  }

  async shot(name: string, target?: Locator) {
    const file = this.info.outputPath(`${String(++this.shotNo).padStart(2, '0')}-${name.replace(/[^\p{L}\d]+/gu, '-')}.png`);
    await this.page.waitForTimeout(300);
    if (target) await target.screenshot({ path: file });
    else await this.page.screenshot({ path: file, fullPage: true });
    await this.info.attach(name, { path: file, contentType: 'image/png' });
  }

  async flush() {
    if (!this.lines.length) return;
    const body = this.lines.join('\n');
    console.log(`\n[${this.info.title}]\n${body}`);
    await this.info.attach('Kết quả', { body, contentType: 'text/plain' });
  }
}

export async function waitIdle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

export const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** khớp đúng cả chữ (bỏ khoảng trắng 2 đầu) */
export const exactRe = (s: string, flags = 'i') => new RegExp(`^\\s*${escapeRe(s)}\\s*$`, flags);

/** Dữ liệu bước trước để lại cho bước sau (vd id vừa tạo) — file JSON trong thư mục kết quả của project */
export function stateStore<T extends object>(info: TestInfo, name: string) {
  const file = path.join(info.project.outputDir, `${name}-state.json`);
  return {
    read(): Partial<T> {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
    },
    write(data: Partial<T>) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    },
  };
}

/**
 * Thanh phân trang (app-pagination): > pageSize dòng → PHẢI hiện "Trang 1 / N", bấm "Trang sau" sang trang 2
 * đúng số dòng, không lặp; ≤ pageSize → PHẢI ẩn. nextPage() = bấm "Trang sau" rồi trả về các dòng trang 2 (từ API).
 */
export async function checkPagination(
  page: Page,
  steps: Steps,
  opts: { total: number; firstPage: any[]; idOf: (x: any) => unknown; nextPage: () => Promise<any[]>; pageSize?: number; label?: string },
) {
  const size = opts.pageSize ?? 20;
  const label = opts.label ?? '';
  const bar = page.locator('app-pagination').getByText(/Trang\s+\d+\s*\/\s*\d+/);
  const shouldShow = opts.total > size;
  const shown = await bar.isVisible();
  steps.check(shown === shouldShow, `${label}${opts.total} dòng → phân trang phải ${shouldShow ? 'HIỆN' : 'ẨN'}`, `đang ${shown ? 'hiện' : 'ẩn'}`);
  steps.check(opts.firstPage.length === Math.min(size, opts.total), `${label}Trang 1 có ${Math.min(size, opts.total)} dòng`, `${opts.firstPage.length}`);
  if (!shown || !shouldShow) return;

  const pages = Math.ceil(opts.total / size);
  const text = ((await bar.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  steps.check(new RegExp(`Trang\\s*1\\s*/\\s*${pages}\\b`).test(text), `${label}Số trang = ${pages}`, text);
  await page.locator('app-pagination').scrollIntoViewIfNeeded();
  await steps.shot(`${label}Phân trang — trang 1`);

  const second = await opts.nextPage();
  const need = Math.min(size, opts.total - size);
  steps.check(second.length === need, `${label}"Trang sau" → trang 2 có ${need} dòng`, `${second.length} dòng`);
  const dup = second.filter((x) => opts.firstPage.some((y) => opts.idOf(y) === opts.idOf(x)));
  steps.check(dup.length === 0, `${label}Trang 2 không lặp dòng của trang 1`, dup.length ? `${dup.length} dòng trùng` : '');
  await steps.shot(`${label}Phân trang — trang 2`);
}

/** "2% GTGT, 1% TNCN" / "8%" → 2 / 8 (số % đầu tiên) */
export const firstPercent = (text: string | null | undefined): number | null => {
  const m = (text ?? '').match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1].replace(',', '.')) : null;
};
