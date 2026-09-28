import { Locator, Page, TestInfo, expect } from '@playwright/test';

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

/** "2% GTGT, 1% TNCN" / "8%" → 2 / 8 (số % đầu tiên) */
export const firstPercent = (text: string | null | undefined): number | null => {
  const m = (text ?? '').match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1].replace(',', '.')) : null;
};
