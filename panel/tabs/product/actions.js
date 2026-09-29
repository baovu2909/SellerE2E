/** Tab Sản phẩm — lệnh chạy phía server */
const { saveUploads } = require('../../lib/helpers');

/** Ô nhập của thẻ Sản phẩm → env cho tests/features/product.spec.ts (ô trống → test dùng mặc định) */
function productEnv(p) {
  const f = p.product ?? {};
  const out = {};
  const text = { name: 'PRODUCT_NAME', code: 'PRODUCT_CODE', category: 'PRODUCT_CATEGORY', shortDesc: 'PRODUCT_SHORT_DESC', sku: 'PRODUCT_SKU', unit: 'PRODUCT_UNIT', editName: 'PRODUCT_EDIT_NAME' };
  for (const [k, envName] of Object.entries(text)) {
    const v = String(f[k] ?? '').trim();
    if (v.length > 255) throw new Error(`Ô "${k}" tối đa 255 ký tự`);
    if (v) out[envName] = v;
  }
  if (f.code && !/^\d{13}$/.test(String(f.code).trim())) throw new Error('Mã EAN-13 phải gồm đúng 13 chữ số');

  const nums = { cost: ['PRODUCT_COST', 'Giá vốn'], price: ['PRODUCT_PRICE', 'Giá bán'], editPrice: ['PRODUCT_EDIT_PRICE', 'Giá bán khi sửa'] };
  if (f.type === 'dich-vu') delete nums.cost; // dịch vụ không có giá vốn
  for (const [k, [envName, label]] of Object.entries(nums)) {
    const v = String(f[k] ?? '').replace(/[.,\s]/g, '');
    if (!v) continue;
    if (!/^\d+$/.test(v)) throw new Error(`${label} phải là số nguyên không âm`);
    out[envName] = v;
  }
  if (f.type === 'dich-vu') out.PRODUCT_TYPE = 'dich-vu';

  // Tồn kho theo cửa hàng: [{ name, qty }] → PRODUCT_STORES (JSON)
  const stores = (Array.isArray(f.stores) ? f.stores : [])
    .map((s) => ({ name: String(s?.name ?? '').trim(), qty: String(s?.qty ?? '').replace(/[.,\s]/g, '') }))
    .filter((s) => s.name);
  if (stores.length > 50) throw new Error('Tối đa 50 cửa hàng');
  const seen = new Set();
  for (const s of stores) {
    if (s.name.length > 100) throw new Error(`Tên cửa hàng "${s.name.slice(0, 20)}…" quá dài`);
    if (seen.has(s.name.toLowerCase())) throw new Error(`Cửa hàng "${s.name}" bị nhập 2 lần`);
    seen.add(s.name.toLowerCase());
    if (s.qty && !/^\d+$/.test(s.qty)) throw new Error(`Số lượng của "${s.name}" phải là số nguyên không âm`);
    if (f.type === 'dich-vu') s.qty = ''; // dịch vụ không có tồn kho
  }
  if (stores.length) out.PRODUCT_STORES = JSON.stringify(stores.map((s) => ({ name: s.name, qty: s.qty ? Number(s.qty) : null })));

  const images = saveUploads(p.uploads?.images, 10, 'Ảnh sản phẩm');
  if (images.length) out.PRODUCT_IMAGES = images.join('|');
  const excel = saveUploads(p.uploads?.importFile ? [p.uploads.importFile] : [], 1, 'File nhập');
  if (excel.length) out.PRODUCT_IMPORT_FILE = excel[0];
  return out;
}

module.exports = {
  product: {
    args: () => ['test', '--project=features', 'tests/features/product.spec.ts'],
    env: productEnv,
  },
  'product-import': {
    args: () => ['test', '--project=features', 'tests/features/product.spec.ts', '-g', '7. Nhập'],
    env: productEnv,
  },
};
