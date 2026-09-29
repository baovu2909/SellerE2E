import { Page, Response, TestInfo } from '@playwright/test';

const STATUS_TEXT: Record<number, string> = {
  400: 'Dữ liệu gửi lên không hợp lệ',
  401: 'Chưa đăng nhập / phiên đăng nhập hết hạn',
  403: 'Không có quyền',
  404: 'Không tìm thấy',
  409: 'Bị trùng dữ liệu',
  413: 'Dữ liệu gửi lên quá lớn',
  500: 'Lỗi hệ thống phía server',
  502: 'Server không phản hồi (Bad Gateway)',
  503: 'Server đang bận / bảo trì',
  504: 'Server phản hồi quá lâu',
};

export function watchApiErrors(page: Page, info: TestInfo) {
  const lines: string[] = [];
  const pending = new Set<Promise<void>>();

  const onResponse = (res: Response) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/')) return;
    const req = res.request();
    const job = (async () => {
      const status = res.status();
      const isJson = (res.headers()['content-type'] ?? '').includes('json');
      if (status < 400 && !isJson) return;
      const text = await res.text().catch(() => '');
      let body: any = null;
      try { body = JSON.parse(text); } catch {}
      const failed = status >= 400 || body?.type === 'error' || body?.isSuccess === false;
      if (!failed) return;

      const msg =
        body?.message ||
        body?.title ||
        body?.errorMessage ||
        (body?.errors ? JSON.stringify(body.errors).slice(0, 200) : '') ||
        text.slice(0, 200) ||
        res.statusText() ||
        STATUS_TEXT[status] ||
        '(server không trả nội dung)';
      lines.push(`⚠ API ${status} ${req.method()} ${url.pathname}${url.search} — ${String(msg).replace(/\s+/g, ' ').trim()}`);
      const sent = req.postData();
      if (sent && !/password|matkhau/i.test(sent)) lines.push(`    gửi đi: ${sent.replace(/\s+/g, ' ').slice(0, 300)}${sent.length > 300 ? '…' : ''}`);
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
  };

  page.on('response', onResponse);

  return async () => {
    page.off('response', onResponse);
    await Promise.allSettled([...pending]);
    if (!lines.length) return;
    const body = lines.join('\n');
    console.log(`\n[${info.title}] Lỗi API:\n${body}`);
    await info.attach('Lỗi API', { body, contentType: 'text/plain' });
  };
}
