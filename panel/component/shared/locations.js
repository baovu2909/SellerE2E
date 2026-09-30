import { onSellerSync } from './seller-sync.js';

const provinces = {};
const wards = {};

async function get(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j.list.map((x) => ({ ...x, children: [] }));
}

export function loadProvinces(env, force = false) {
  if (force || !provinces[env]) {
    provinces[env] = get(`/seller/provinces?env=${env}`);
    provinces[env].catch(() => delete provinces[env]);
  }
  return provinces[env];
}

export function loadWards(env, provinceId) {
  const key = `${env}:${provinceId}`;
  if (!wards[key]) {
    wards[key] = get(`/seller/wards?env=${env}&provinceId=${provinceId}`);
    wards[key].catch(() => delete wards[key]);
  }
  return wards[key];
}

onSellerSync('Tỉnh / phường', (env) => {
  for (const key of Object.keys(wards)) if (key.startsWith(`${env}:`)) delete wards[key];
  return loadProvinces(env, true);
});
