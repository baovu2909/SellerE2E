const { int } = require('../../lib/helpers');

// ô nhập thẻ "Tạo → Xem → Sửa cửa hàng" → env cho tests/features/store.spec.ts (ô trống → mặc định trong test)
function storeEnv(p) {
  const f = p.store ?? {};
  const out = {};
  const map = {
    name: 'STORE_NAME', code: 'STORE_LOCATION_CODE', hotline: 'STORE_HOTLINE', email: 'STORE_EMAIL', address: 'STORE_ADDRESS',
    province: 'STORE_PROVINCE', ward: 'STORE_WARD', editName: 'STORE_EDIT_NAME', editHotline: 'STORE_EDIT_HOTLINE', editEmail: 'STORE_EDIT_EMAIL',
  };
  for (const [k, envName] of Object.entries(map)) {
    const v = String(f[k] ?? '').trim();
    if (v.length > 255) throw new Error(`Ô "${k}" quá dài`);
    if (v) out[envName] = v;
  }
  for (const k of ['hotline', 'editHotline']) {
    if (f[k] && !/^\+?\d[\d\s.-]{7,14}$/.test(String(f[k]).trim())) throw new Error(`Số hotline "${f[k]}" không hợp lệ`);
  }
  for (const k of ['email', 'editEmail']) {
    if (f[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f[k]).trim())) throw new Error(`Email "${f[k]}" không hợp lệ`);
  }
  if (f.code && !/^\d+$/.test(String(f.code).trim())) throw new Error('Mã địa điểm kinh doanh chỉ gồm chữ số');
  out.STORE_COUNT = String(int(f.count || 1, 1, 50, 'Số lượng tạo'));
  return out;
}

module.exports = {
  store: {
    args: () => ['test', '--project=features', 'tests/features/store.spec.ts'],
    env: storeEnv,
  },
};
