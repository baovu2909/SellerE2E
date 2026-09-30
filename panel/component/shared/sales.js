import { onSellerSync } from './seller-sync.js';

const stores = {};
const products = {};

async function get(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j.list;
}

function cached(map, key, url) {
  if (!map[key]) {
    map[key] = get(url);
    map[key].catch(() => delete map[key]);
  }
  return map[key];
}

export const loadStores = (env) => cached(stores, env, `/seller/stores?env=${env}`);

export const loadProducts = (env, storeId = '') => cached(products, `${env}:${storeId}`, `/seller/products?env=${env}&storeId=${storeId}`);

const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;

export const storeNodes = (list) => list.map((s) => ({ ...s, label: s.isDefault ? `${s.name} (mặc định)` : s.name, children: [] }));

export const productNodes = (list) =>
  list.map((p) => ({
    ...p,
    key: String(p.id),
    label: `${p.name} — ${money(p.price)}${p.stock === null ? '' : p.stock > 0 ? ` · tồn ${p.stock}` : ' · hết hàng'}`,
    disabled: p.stock !== null && p.stock <= 0,
    children: [],
  }));

onSellerSync('Cửa hàng / sản phẩm', (env) => {
  delete stores[env];
  for (const key of Object.keys(products)) if (key.startsWith(`${env}:`)) delete products[key];
  return loadStores(env);
});
