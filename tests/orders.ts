import { Locator, Page, Response } from '@playwright/test';
import { expect } from './shared-page';
import { escapeRe, norm, waitIdle } from './features/helpers';

interface Steps {
  note(text: string): void;
  check(ok: boolean, label: string, detail?: string): void;
  shot(name: string, target?: Locator): Promise<void>;
}

const isList = (r: Response) => r.url().includes('/orders/order-offline') && !r.url().includes('export') && r.request().method() === 'POST' && r.ok();
export const nextList = (page: Page, match: (req: any) => boolean = () => true) =>
  page.waitForResponse((r) => isList(r) && match(r.request().postDataJSON() ?? {}), { timeout: 20_000 }).catch(() => null);

export async function result(res: Promise<Response | null>) {
  const r = await res;
  const body = await r?.json().catch(() => null);
  const req = r?.request().postDataJSON() ?? {};
  return { items: (body?.items ?? []) as any[], total: Number(body?.total ?? NaN), params: req.searchParams ?? {}, page: Number(req.page ?? 1) };
}

export const rowOf = (page: Page, code: string) => page.locator('tbody tr').filter({ hasText: new RegExp(`\\b${escapeRe(code)}\\b`) }).first();

export const settle = async (target: Locator) => {
  await target.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await target.page().waitForTimeout(300);
};

export async function findInvoice(page: Page, code: string): Promise<any | null> {
  for (let i = 0; i < 6; i++) {
    if (i) await page.waitForTimeout(10_000);
    const res = page.waitForResponse((r) => r.url().includes('/e-invoice/list') && r.request().method() === 'POST' && r.ok(), { timeout: 20_000 }).catch(() => null);
    await page.goto('/sales');
    await expect(page, 'Không vào được trang Hoá đơn đầu ra (bị chặn quyền / hết phiên?)').not.toHaveURL(/\/errors\/|\/auth\//);
    const body = await (await res)?.json().catch(() => null);
    const found = (body?.items ?? []).find((x: any) => x.orderCode === code);
    if (found) return found;
  }
  return null;
}

/** Mở chi tiết 1 đơn (từ danh sách lọc theo mã) → trả dữ liệu API chi tiết */
export async function openDetail(page: Page, o: { orderId: number; orderCode: string }) {
  await result(nextListFor(page, o.orderCode));
  const res = page.waitForResponse((r) => r.url().includes(`/orders/${o.orderId}/offline`) && r.request().method() === 'GET', { timeout: 20_000 });
  await rowOf(page, o.orderCode).locator('amf-tooltip[text="Xem chi tiết"] button').click();
  await expect(page).toHaveURL(new RegExp(`/orders/order-detail-offline/${o.orderId}`));
  return (await (await res).json())?.data;
}

/** Hoá đơn đầu ra: menu ⋯ của hoá đơn đơn `code` → "Hủy hóa đơn" → nhập lý do → "Hủy Hóa Đơn" */
async function cancelInvoice(page: Page, steps: Steps, code: string) {
  const inv = await findInvoice(page, code);
  if (!inv) return steps.check(false, `Hủy HĐĐT đơn ${code}`, 'không thấy hoá đơn ở Hoá đơn đầu ra');
  const row = rowOf(page, code);
  await settle(row);
  await row.locator('td').last().locator('button').first().click();
  // nút trong menu có ảnh alt="Export" → tên nút là "Export Hủy hóa đơn", so theo chữ hiển thị
  await page.locator('button:visible').filter({ hasText: /^\s*Hủy hóa đơn\s*$/ }).first().click();
  const reason = page.locator('amf-input[label="Lý do huỷ"] input');
  await expect(reason, 'Không mở được hộp "Hủy hóa đơn điện tử"').toBeVisible();
  await reason.fill(`Test tự động — hủy đơn test ${code}`);
  await steps.shot(`Hủy HĐĐT đơn ${code} — nhập lý do`);
  const res = page.waitForResponse((r) => r.url().includes('/e-invoice/delete') && r.request().method() === 'POST', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Hủy Hóa Đơn', exact: true }).click();
  const r = await res;
  const body = await r.json().catch(() => null);
  steps.check(r.ok() && body?.type === 'success', `Hủy HĐĐT đơn ${code} (ký hiệu ${inv.khieu})`, `API ${r.status()}${body?.message ? `: ${body.message}` : ''}`);
  await steps.shot(`Hủy HĐĐT đơn ${code}`);
}

/**
 * Hủy 1 đơn test: bấm "Hủy đơn hàng" ở chi tiết. Đơn có HĐĐT chờ ký thì hệ thống báo "Không Thể Hủy"
 * → vào Hoá đơn đầu ra hủy hoá đơn (nhập lý do) → quay lại đơn hủy lần nữa.
 */
export async function cancelTestOrder(page: Page, steps: Steps, o: { orderId: number; orderCode: string }) {
  steps.note(`— Hủy đơn ${o.orderCode}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const detail = await openDetail(page, o);
    const locked = Boolean(detail?.einvoiceId) && norm(detail?.einvoiceStatus ?? '') === 'chờ ký';
    await page.getByRole('button', { name: /Hủy đơn hàng/ }).click();
    const cannot = page.getByText('Không Thể Hủy Đơn Hàng');
    const confirm = page.getByText('Xác Nhận Hủy Đơn Hàng');
    await expect(cannot.or(confirm), 'Bấm "Hủy đơn hàng" không hiện hộp nào').toBeVisible();
    await steps.shot(`Hủy đơn ${o.orderCode} — hộp thoại`);

    if (await cannot.isVisible()) {
      steps.check(locked, `Đơn ${o.orderCode} có HĐĐT chờ ký → báo "Không Thể Hủy Đơn Hàng"`, locked ? '' : `nhưng HĐĐT đang "${detail?.einvoiceStatus ?? 'không có'}"`);
      await page.getByRole('button', { name: 'Đồng Ý', exact: true }).click();
      if (attempt) return steps.check(false, `Hủy đơn ${o.orderCode}`, 'đã hủy HĐĐT mà vẫn báo "Không Thể Hủy"');
      await cancelInvoice(page, steps, o.orderCode);
      continue;
    }
    steps.check(!locked, `Đơn ${o.orderCode} không còn HĐĐT chờ ký → cho hủy`, locked ? 'HĐĐT chờ ký mà vẫn cho hủy' : '');
    const del = page.waitForResponse((r) => r.url().includes(`/orders/${o.orderId}/offline`) && r.request().method() === 'DELETE', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    const r = await del;
    const body = await r.json().catch(() => null);
    steps.check(r.ok() && body?.type !== 'error', `Hủy đơn ${o.orderCode}`, `API ${r.status()}${body?.message ? `: ${body.message}` : ''}`);
    const now = (await result(nextListFor(page, o.orderCode))).items.find((x) => x.id === o.orderId);
    steps.check(!now || now.isDelete, `Sau khi hủy: đơn ${o.orderCode} bị đánh dấu hủy`, now ? `isDelete=${now.isDelete}` : 'không còn trong danh sách');
    await steps.shot(`Sau khi hủy đơn ${o.orderCode}`);
    return;
  }
}

/** Mở danh sách đã lọc sẵn theo mã đơn (để đọc lại trạng thái 1 đơn) */
export function nextListFor(page: Page, code: string) {
  const res = nextList(page, (req) => req.searchParams?.orderCode === code);
  (async () => {
    await page.goto('/orders');
    await waitIdle(page);
    await page.locator('amf-input[label="Mã đơn hàng"] input').fill(code);
  })().catch(() => {});
  return res;
}
