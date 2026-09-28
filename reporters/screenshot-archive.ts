import fs from 'fs';
import path from 'path';
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Lưu lại ảnh chụp của MỌI lần chạy (Playwright tự xoá test-results/ mỗi lần chạy mới),
 * tách theo kết quả:
 *
 *   screenshots/<env>/success/<ngày_giờ>/<tên test>/01-....png
 *   screenshots/<env>/error/<ngày_giờ>/<tên test>/01-....png + loi.txt
 *
 * Mỗi thư mục test có thêm ket-qua.txt nếu test ghi kết quả (vd kiểm tra doanh thu).
 * Bản cũ hơn SCREENSHOT_KEEP_DAYS ngày (mặc định 14) tự bị xoá. Bỏ qua bước đăng nhập (project setup).
 */
const ROOT = path.resolve(__dirname, '..', 'screenshots');
const KEEP_DAYS = Number(process.env.SCREENSHOT_KEEP_DAYS ?? 14);

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
/** Tên thư mục / file an toàn trên Windows, giữ tiếng Việt */
const safe = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

export default class ScreenshotArchive implements Reporter {
  private env = (process.env.ENV ?? 'dev').toLowerCase();
  private runName = stamp(new Date());
  private saved = { success: 0, error: 0 };

  onBegin(_config: FullConfig, _suite: Suite) {
    this.cleanup();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name ?? '';
    if (project === 'setup' || result.status === 'skipped') return;

    const images = result.attachments.filter((a) => a.contentType.startsWith('image/') && a.path && fs.existsSync(a.path));
    const notes = result.attachments.filter((a) => a.contentType.startsWith('text/plain') && a.body);
    if (!images.length && !notes.length && result.status === 'passed') return;

    const kind = result.status === 'passed' ? 'success' : 'error';
    // titlePath = ['', project, file, ...describe, test] → tên thư mục "<describe> - <test>"
    const title = test.titlePath().slice(3).filter(Boolean).join(' - ');
    let dir = path.join(ROOT, this.env, kind, this.runName, safe(title));
    // test chạy lại (retry) → không ghi đè
    for (let i = 2; fs.existsSync(dir); i++) dir = `${dir.replace(/ \(\d+\)$/, '')} (${i})`;
    fs.mkdirSync(dir, { recursive: true });

    images.forEach((a, i) => {
      const name = a.name === 'screenshot' ? 'man-hinh-cuoi' : a.name;
      const ext = path.extname(a.path!) || '.png';
      fs.copyFileSync(a.path!, path.join(dir, `${pad(i + 1)}-${safe(name).replace(/\.png$/i, '')}${ext}`));
    });
    for (const n of notes) {
      fs.writeFileSync(path.join(dir, `${safe(n.name === 'Kết quả' ? 'ket-qua' : n.name)}.txt`), n.body!.toString('utf8'));
    }
    if (kind === 'error') {
      const errors = result.errors.map((e) => stripAnsi(e.message ?? e.value ?? '')).join('\n\n---\n\n');
      fs.writeFileSync(path.join(dir, 'loi.txt'), `${title}\n${test.location.file}:${test.location.line}\n\n${errors}`);
    }
    this.saved[kind]++;
  }

  onEnd() {
    const { success, error } = this.saved;
    if (!success && !error) return;
    const rel = (k: string) => path.relative(process.cwd(), path.join(ROOT, this.env, k, this.runName));
    console.log(`\n📁 Đã lưu ảnh: ${success} test đạt → ${rel('success')}${error ? ` | ${error} test lỗi → ${rel('error')}` : ''}`);
  }

  /** Xoá các lần chạy cũ hơn KEEP_DAYS ngày */
  private cleanup() {
    if (!(KEEP_DAYS > 0)) return;
    const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const kind of ['success', 'error']) {
      const base = path.join(ROOT, this.env, kind);
      if (!fs.existsSync(base)) continue;
      for (const run of fs.readdirSync(base)) {
        const full = path.join(base, run);
        if (fs.statSync(full).mtimeMs < limit) fs.rmSync(full, { recursive: true, force: true });
      }
    }
  }

  printsToStdio() {
    return false;
  }
}
