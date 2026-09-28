/**
 * <ui-file-picker> — ô chọn file tự vẽ: bấm để chọn hoặc kéo thả; ảnh có ảnh thu nhỏ, file khác hiện tên; ✕ để bỏ.
 *
 *   <ui-file-picker id="x" multiple max="10" accept="image/*" placeholder="Chọn ảnh"></ui-file-picker>
 *   el.files            → File[] đang chọn
 *   el.toPayload()      → Promise<[{ name, data (base64) }]> để gửi lên server
 *   el.clear()
 *   sự kiện 'change'    → detail: { files }
 */
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; font: inherit; }
    .zone {
      display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 64px; box-sizing: border-box;
      border: 1.5px dashed var(--border, #d4dae3); border-radius: 10px; padding: 10px 12px; cursor: pointer;
      background: #f8fafc; color: var(--muted, #6b7280); font-size: 13px; text-align: center; transition: .15s;
    }
    .zone:hover, .zone.drag { border-color: var(--primary, #1179ea); background: #eef4ff; color: var(--primary, #1179ea); }
    .zone:focus-visible { outline: 2px solid var(--primary, #1179ea); outline-offset: 2px; }
    .zone svg { width: 20px; height: 20px; flex: none; }
    .zone b { color: var(--primary, #1179ea); font-weight: 600; }
    .list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .list:empty { display: none; }
    .item { position: relative; display: flex; align-items: center; gap: 6px; border: 1px solid var(--border, #e3e7ee);
      border-radius: 8px; background: var(--card, #fff); font-size: 12px; color: var(--text, #1f2430); }
    .item.img { width: 64px; height: 64px; overflow: hidden; }
    .item.img img { width: 100%; height: 100%; object-fit: cover; }
    .item.file { padding: 6px 28px 6px 10px; max-width: 100%; }
    .item.file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item .size { color: var(--muted, #6b7280); flex: none; }
    .del { position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; border: 0; border-radius: 50%; padding: 0;
      display: grid; place-items: center; cursor: pointer; background: rgba(15, 23, 42, .6); color: #fff; font-size: 12px; line-height: 1; }
    .item.file .del { top: 50%; transform: translateY(-50%); background: #e2e8f0; color: #334155; }
    .del:hover { background: var(--danger, #dc2626); color: #fff; }
    .err { color: var(--danger, #dc2626); font-size: 12px; margin-top: 6px; }
    .err:empty { display: none; }
    input { display: none; }
  </style>
  <div class="zone" tabindex="0" role="button">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>
    <span class="label"></span>
  </div>
  <input type="file" />
  <div class="list"></div>
  <div class="err"></div>
`;

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const MAX_SIZE = 25 * 1024 * 1024;

class UiFilePicker extends HTMLElement {
  #files = [];
  #urls = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(template.content.cloneNode(true));
    this.zone = root.querySelector('.zone');
    this.input = root.querySelector('input');
    this.list = root.querySelector('.list');
    this.err = root.querySelector('.err');

    this.zone.addEventListener('click', () => this.input.click());
    this.zone.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.input.click()));
    this.input.addEventListener('change', () => { this.#add([...this.input.files]); this.input.value = ''; });
    for (const ev of ['dragenter', 'dragover']) this.zone.addEventListener(ev, (e) => { e.preventDefault(); this.zone.classList.add('drag'); });
    for (const ev of ['dragleave', 'drop']) this.zone.addEventListener(ev, () => this.zone.classList.remove('drag'));
    this.zone.addEventListener('drop', (e) => { e.preventDefault(); this.#add([...e.dataTransfer.files]); });
  }

  connectedCallback() {
    this.input.multiple = this.multiple;
    if (this.getAttribute('accept')) this.input.accept = this.getAttribute('accept');
    this.#render();
  }

  get multiple() { return this.hasAttribute('multiple'); }
  get max() { return Number(this.getAttribute('max') || (this.multiple ? 50 : 1)); }
  get files() { return [...this.#files]; }

  clear() { this.#files = []; this.#render(); this.#emit(); }

  /** Đọc file thành base64 để gửi lên server */
  toPayload() {
    return Promise.all(this.#files.map((f) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, data: String(r.result).split(',')[1] });
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    })));
  }

  #accepts(f) {
    const accept = (this.getAttribute('accept') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!accept.length) return true;
    const name = f.name.toLowerCase();
    return accept.some((a) => (a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : a.startsWith('.') ? name.endsWith(a) : f.type === a));
  }

  #add(list) {
    const errors = [];
    let files = this.multiple ? [...this.#files] : [];
    for (const f of list) {
      if (!this.#accepts(f)) { errors.push(`"${f.name}" không đúng loại file`); continue; }
      if (f.size > MAX_SIZE) { errors.push(`"${f.name}" quá 25 MB`); continue; }
      if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
      files.push(f);
      if (!this.multiple) break;
    }
    if (files.length > this.max) { errors.push(`Tối đa ${this.max} file — bỏ bớt ${files.length - this.max} file cuối`); files = files.slice(0, this.max); }
    this.#files = files;
    this.err.textContent = errors.join(' · ');
    this.#render();
    this.#emit();
  }

  #emit() { this.dispatchEvent(new CustomEvent('change', { detail: { files: this.files }, bubbles: true })); }

  #render() {
    this.#urls.forEach((u) => URL.revokeObjectURL(u));
    this.#urls = [];
    const n = this.#files.length;
    const placeholder = this.getAttribute('placeholder') || (this.multiple ? 'Chọn file' : 'Chọn 1 file');
    this.zone.querySelector('.label').innerHTML = n
      ? `Đã chọn <b>${n}</b>${this.multiple ? `/${this.max}` : ''} — bấm hoặc kéo thả để ${this.multiple ? 'thêm' : 'đổi'}`
      : `<b>${placeholder}</b> hoặc kéo thả vào đây`;
    this.list.replaceChildren(...this.#files.map((f, i) => {
      const item = document.createElement('div');
      const isImg = f.type.startsWith('image/');
      item.className = `item ${isImg ? 'img' : 'file'}`;
      item.title = `${f.name} (${kb(f.size)})`;
      if (isImg) {
        const url = URL.createObjectURL(f);
        this.#urls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = f.name;
        item.append(img);
      } else {
        const name = document.createElement('span');
        name.textContent = f.name;
        const size = document.createElement('span');
        size.className = 'size';
        size.textContent = kb(f.size);
        item.append(name, size);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '✕';
      del.title = 'Bỏ file này';
      del.setAttribute('aria-label', `Bỏ ${f.name}`);
      del.onclick = (e) => { e.stopPropagation(); this.#files.splice(i, 1); this.err.textContent = ''; this.#render(); this.#emit(); };
      item.append(del);
      return item;
    }));
  }
}

customElements.define('ui-file-picker', UiFilePicker);
