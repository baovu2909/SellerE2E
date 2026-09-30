// <ui-dropdown-tree level noun placeholder empty-label> — ô chọn có tìm kiếm, dữ liệu cây qua .loader; .path / .value / .node
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; position: relative; font: inherit; }
    .trigger {
      width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border: 1px solid var(--border, #e3e7ee); border-radius: 8px; padding: 8px 10px;
      background: var(--card, #fff); color: var(--text, #1f2430); font: inherit; font-size: 14px; text-align: left; cursor: pointer;
    }
    .trigger:hover { border-color: #c5ccd8; }
    .trigger:focus-visible, :host([open]) .trigger { outline: none; border-color: var(--primary, #1179ea); }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .label.placeholder { color: var(--muted, #6b7280); }
    .label.error { color: var(--danger, #dc2626); }
    svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--muted, #6b7280); }
    .trigger > svg { transition: transform .15s; }
    :host([open]) .trigger > svg { transform: rotate(180deg); }
    .panel {
      /* fixed → nổi đè lên trang, không đẩy / kéo giãn khung cuộn bên ngoài; toạ độ đặt trong #place() */
      display: none; position: fixed; z-index: 1000; box-sizing: border-box; background: var(--card, #fff);
      border: 1px solid var(--border, #e3e7ee); border-radius: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, .12);
    }
    :host([open]) .panel { display: block; }
    .head { display: flex; gap: 6px; padding: 6px; border-bottom: 1px solid var(--border, #e3e7ee); }
    .head input {
      flex: 1; min-width: 0; border: 1px solid var(--border, #e3e7ee); border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 13px;
    }
    .head input:focus { outline: none; border-color: var(--primary, #1179ea); }
    ul { list-style: none; margin: 0; padding: 4px; max-height: 280px; overflow-y: auto; }
    /* shadow DOM không nhận CSS thanh cuộn chung → chép lại từ panel.css */
    ul::-webkit-scrollbar { width: 6px; height: 6px; }
    ul::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
    ul::-webkit-scrollbar-track, ul::-webkit-scrollbar-corner { background: transparent; }
    ul::-webkit-scrollbar-thumb { background: #d7dde6; border-radius: 99px; }
    ul:hover::-webkit-scrollbar-thumb { background: #aab4c3; }
    ul::-webkit-scrollbar-thumb:hover { background: #8b97a8; }
    @supports not selector(::-webkit-scrollbar) {
      ul { scrollbar-width: thin; scrollbar-color: #d7dde6 transparent; }
    }
    li { display: flex; align-items: center; gap: 4px; padding: 7px 8px; border-radius: 6px; font-size: 14px; color: var(--text, #1f2430); cursor: pointer; }
    li:hover { background: #eef4ff; }
    li.group { color: var(--muted, #6b7280); }
    li.group.l1 { font-weight: 600; color: var(--text, #1f2430); }
    li .chev { width: 14px; height: 14px; transition: transform .15s; }
    li.expanded .chev { transform: rotate(90deg); }
    li .spacer { width: 14px; flex-shrink: 0; }
    li[aria-selected="true"] { color: var(--primary, #1179ea); font-weight: 600; }
    li[aria-selected="true"]::after { content: '✓'; margin-left: auto; }
    li.empty-opt { font-style: italic; }
    li.disabled { color: var(--muted, #6b7280); opacity: .55; cursor: not-allowed; }
    li.disabled:hover { background: none; }
    .note { padding: 10px; font-size: 13px; color: var(--muted, #6b7280); }
    .note.error { color: var(--danger, #dc2626); }
  </style>
  <button type="button" class="trigger" aria-haspopup="tree">
    <span class="label placeholder"></span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
  </button>
  <div class="panel">
    <div class="head">
      <input type="text" placeholder="Tìm danh mục…" />
    </div>
    <ul role="tree"></ul>
  </div>
`;

const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" /></svg>';
// nút có key (vd id sản phẩm) thì phân biệt theo key — tên có thể trùng
const idOf = (n) => String(n.key ?? n.name);
const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase().trim();

export class UiDropdownTree extends HTMLElement {
  #tree = null;
  #error = '';
  #path = [];
  #expanded = new Set();
  defaultPath = [];
  loader = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(template.content.cloneNode(true));
    this.trigger = root.querySelector('.trigger');
    this.labelEl = root.querySelector('.label');
    this.search = root.querySelector('input');
    this.list = root.querySelector('ul');
    this.trigger.addEventListener('click', () => (this.hasAttribute('open') ? this.close() : this.show()));
    this.search.addEventListener('input', () => this.#renderList());
    // nút "Đồng Bộ" trên thanh trên cùng đã tải lại cache → chỉ cần vẽ lại
    window.addEventListener('seller:synced', () => { if (this.loader) this.load(); });
    this.list.addEventListener('click', (e) => this.#onClick(e.target.closest('li')));
    this.onOutside = (e) => { if (!e.composedPath().includes(this)) this.close(); };
    this.onKey = (e) => { if (e.key === 'Escape') this.close(); };
    // trang cuộn / đổi kích thước → đặt lại vị trí (cuộn bên trong danh sách thì bỏ qua)
    this.onMove = (e) => { if (this.hasAttribute('open') && !e.composedPath?.().includes(this.list)) this.#place(); };
    this.panel = root.querySelector('.panel');
  }

  connectedCallback() {
    document.addEventListener('click', this.onOutside);
    document.addEventListener('scroll', this.onMove, true);
    window.addEventListener('resize', this.onMove);
    this.addEventListener('keydown', this.onKey);
    this.search.placeholder = `Tìm ${this.noun}…`;
    this.#renderLabel();
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.onOutside);
    document.removeEventListener('scroll', this.onMove, true);
    window.removeEventListener('resize', this.onMove);
  }

  get level() { return Number(this.getAttribute('level') || 1); }
  get noun() { return this.getAttribute('noun') || 'danh mục'; }
  get path() { return [...this.#path]; }
  get value() { return this.node?.name ?? ''; }
  get node() { return this.#find(this.#path); }

  async load() {
    this.#tree = null;
    this.#error = '';
    this.#renderLabel(`Đang tải ${this.noun}…`);
    this.#renderList();
    try {
      this.#tree = await this.loader();
    } catch (e) {
      this.#error = e.message;
    }
    if (!this.#find(this.#path)) this.#path = [];
    if (!this.#path.length && this.#find(this.defaultPath)) this.#path = [...this.defaultPath];
    this.#expanded = new Set(this.#path.slice(0, -1).map((_, i) => this.#path.slice(0, i + 1).join('›')));
    this.#renderLabel();
    this.#renderList();
    this.dispatchEvent(new CustomEvent('change', { bubbles: true }));
  }

  #place() {
    const r = this.trigger.getBoundingClientRect();
    const height = Math.min(this.panel.scrollHeight || 330, 330);
    // rộng tối thiểu 380px cho tên dài khỏi xuống dòng; tràn phải thì dời sang trái
    const width = Math.min(Math.max(r.width, 380), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 8;
    const up = below < height && r.top > below;
    Object.assign(this.panel.style, {
      left: `${left}px`,
      width: `${width}px`,
      top: up ? '' : `${r.bottom + 4}px`,
      bottom: up ? `${window.innerHeight - r.top + 4}px` : '',
    });
  }

  show() {
    this.setAttribute('open', '');
    this.#place();
    this.search.value = '';
    this.#renderList();
    this.search.focus();
    const sel = this.list.querySelector('[aria-selected="true"]');
    if (sel) this.list.scrollTop = sel.offsetTop - this.list.clientHeight / 2;
    this.#place();
  }

  close() { this.removeAttribute('open'); }

  #nodes(path) {
    const out = [];
    let list = this.#tree ?? [];
    for (const id of path ?? []) {
      const node = list.find((c) => idOf(c) === id);
      if (!node) return null;
      out.push(node);
      list = node.children;
    }
    return out;
  }

  #find(path) {
    const nodes = this.#nodes(path);
    return nodes?.length && nodes.length === this.level ? nodes.at(-1) : null;
  }

  // nhánh không có cấp cần chọn thì ẩn (vd chọn cấp 3 mà cấp 2 chưa có cấp 3 nào)
  #hasLeaf(node, depth) {
    return depth === this.level || node.children.some((c) => this.#hasLeaf(c, depth + 1));
  }

  #renderLabel(text) {
    const empty = this.getAttribute('empty-label');
    this.labelEl.className = 'label';
    if (text) {
      this.labelEl.textContent = text;
      this.labelEl.classList.add('placeholder');
    } else if (this.#error) {
      this.labelEl.textContent = `Không tải được ${this.noun} — chạy sẽ dùng mặc định`;
      this.labelEl.classList.add('error');
      this.title = this.#error;
    } else if (this.#path.length) {
      this.labelEl.textContent = (this.#nodes(this.#path) ?? []).map((n, i, all) => (i === all.length - 1 ? n.label ?? n.name : n.name)).join(' › ');
      this.title = this.labelEl.textContent;
    } else {
      this.labelEl.textContent = empty || this.getAttribute('placeholder') || `Chọn ${this.noun}…`;
      this.labelEl.classList.toggle('placeholder', !empty);
    }
  }

  #renderList() {
    const items = [];
    if (this.#error) {
      this.list.innerHTML = `<div class="note error">${this.#error.replace(/</g, '&lt;')}</div>`;
      return;
    }
    if (!this.#tree) {
      this.list.innerHTML = '<div class="note">Đang tải…</div>';
      return;
    }
    const q = norm(this.search.value);
    const matches = (node, depth) => norm(`${node.name} ${node.label ?? ''}`).includes(q) || (depth < this.level && node.children.some((c) => matches(c, depth + 1)));
    const empty = this.getAttribute('empty-label');
    if (empty && !q) items.push({ key: '', name: empty, depth: 1, pick: true, emptyOpt: true });

    const walk = (list, depth, parent) => {
      for (const node of list) {
        if (!this.#hasLeaf(node, depth) || (q && !matches(node, depth))) continue;
        const key = [...parent, idOf(node)].join('›');
        const pick = depth === this.level;
        const open = !pick && (q ? true : this.#expanded.has(key));
        items.push({ key, name: node.label ?? node.name, depth, pick, open, disabled: pick && !!node.disabled });
        if (open) walk(node.children, depth + 1, [...parent, idOf(node)]);
      }
    };
    walk(this.#tree, 1, []);

    const current = this.#path.join('›');
    this.list.replaceChildren(...items.map((it) => {
      const li = document.createElement('li');
      li.dataset.key = it.key;
      li.style.paddingLeft = `${8 + (it.depth - 1) * 16}px`;
      if (it.emptyOpt) li.className = 'empty-opt';
      if (it.disabled) li.className = 'disabled';
      if (it.pick) {
        li.setAttribute('role', 'treeitem');
        li.setAttribute('aria-selected', String(it.key === current));
        if (this.level > 1) li.innerHTML = '<span class="spacer"></span>';
      } else {
        li.className = `group l${it.depth}${it.open ? ' expanded' : ''}`;
        li.innerHTML = CHEV;
      }
      li.append(it.name);
      return li;
    }));
    if (!items.length) this.list.innerHTML = `<div class="note">Không có ${this.noun} phù hợp</div>`;
  }

  #onClick(li) {
    if (!li || li.classList.contains('disabled')) return;
    const key = li.dataset.key;
    if (li.classList.contains('group')) {
      if (norm(this.search.value)) return; // đang tìm: mọi nhánh khớp đều đang mở
      this.#expanded.has(key) ? this.#expanded.delete(key) : this.#expanded.add(key);
      this.#renderList();
      return;
    }
    this.#path = key ? key.split('›') : [];
    this.#renderLabel();
    this.close();
    this.trigger.focus();
    this.dispatchEvent(new CustomEvent('change', { bubbles: true }));
  }
}

customElements.define('ui-dropdown-tree', UiDropdownTree);
