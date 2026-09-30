// nút "Đồng Bộ": gọi lại mọi nguồn đã đăng ký rồi phát sự kiện 'seller:synced'
const sources = new Map();

export function onSellerSync(name, reload) {
  sources.set(name, reload);
}

export async function syncSeller(env) {
  const results = await Promise.allSettled([...sources].map(([name, reload]) => reload(env).catch((e) => Promise.reject(new Error(`${name}: ${e.message}`)))));
  window.dispatchEvent(new CustomEvent('seller:synced', { detail: { env } }));
  return { total: sources.size, errors: results.filter((r) => r.status === 'rejected').map((r) => r.reason.message) };
}
