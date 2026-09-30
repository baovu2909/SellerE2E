import { onSellerSync } from './seller-sync.js';

const cache = {};

export function loadCategories(env, force = false) {
  if (force || !cache[env]) {
    cache[env] = fetch(`/seller/categories?env=${env}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
      return j;
    });
    cache[env].catch(() => delete cache[env]);
  }
  return cache[env];
}

onSellerSync('Danh mục', (env) => loadCategories(env, true));
