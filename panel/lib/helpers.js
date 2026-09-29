const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const int = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} phải là số nguyên từ ${min} đến ${max}`);
  return n;
};

const UPLOAD_ROOT = path.join(ROOT, '.uploads');

function saveUploads(files, max, label) {
  const list = Array.isArray(files) ? files : [];
  if (list.length > max) throw new Error(`${label}: tối đa ${max} file`);
  if (!list.length) return [];
  if (fs.existsSync(UPLOAD_ROOT)) {
    for (const d of fs.readdirSync(UPLOAD_ROOT)) {
      const full = path.join(UPLOAD_ROOT, d);
      if (Date.now() - fs.statSync(full).mtimeMs > 24 * 60 * 60 * 1000) fs.rmSync(full, { recursive: true, force: true });
    }
  }
  const dir = path.join(UPLOAD_ROOT, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return list.map((f, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${path.basename(String(f.name || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}`;
    const buf = Buffer.from(String(f.data || ''), 'base64');
    if (!buf.length) throw new Error(`${label}: file "${f.name}" rỗng`);
    if (buf.length > 25 * 1024 * 1024) throw new Error(`${label}: file "${f.name}" quá 25 MB`);
    const file = path.join(dir, name);
    fs.writeFileSync(file, buf);
    return file;
  });
}

module.exports = { ROOT, int, saveUploads };
