const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; position: relative; font: inherit; }
    button {
      width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border: 1px solid var(--border, #e3e7ee); border-radius: 8px; padding: 8px 10px;
      background: var(--card, #fff); color: var(--text, #1f2430); font: inherit; font-size: 14px;
      text-align: left; cursor: pointer;
    }
    button:hover { border-color: #c5ccd8; }
    button:focus-visible, :host([open]) button { outline: none; border-color: var(--primary, #1179ea); }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .label.placeholder { color: var(--muted, #6b7280); }
    svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--muted, #6b7280); transition: transform .15s; }
    :host([open]) svg { transform: rotate(180deg); }
    ul {
      display: none; position: absolute; z-index: 50; left: 0; right: 0; top: calc(100% + 4px);
      margin: 0; padding: 4px; list-style: none; max-height: 240px; overflow-y: auto;
      background: var(--card, #fff); border: 1px solid var(--border, #e3e7ee); border-radius: 8px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, .12);
    }
    :host([open]) ul { display: block; }
    li {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 10px; border-radius: 6px; font-size: 14px; color: var(--text, #1f2430); cursor: pointer;
    }
    li.active { background: #eef4ff; }
    li[aria-selected="true"] { color: var(--primary, #1179ea); font-weight: 600; }
    li[aria-selected="true"]::after { content: '✓'; }
  </style>
  <button type="button" aria-haspopup="listbox">
    <span class="label"></span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
  </button>
  <ul role="listbox" tabindex="-1"></ul>
`;

class UiDropdown extends HTMLElement {
  #options = [];
  #value = '';
  #active = -1;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).appendChild(template.content.cloneNode(true));
    this.button = this.shadowRoot.querySelector('button');
    this.labelEl = this.shadowRoot.querySelector('.label');
    this.list = this.shadowRoot.querySelector('ul');

    this.button.addEventListener('click', () => this.toggle());
    this.button.addEventListener('keydown', (e) => this.#onKey(e));
    this.list.addEventListener('mousedown', (e) => e.preventDefault()); // giữ focus ở button
    this.list.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) this.#select(Number(li.dataset.index));
    });
    this.onOutside = (e) => { if (!e.composedPath().includes(this)) this.close(); };
  }

  connectedCallback() {
    this.#options = [...this.querySelectorAll('option')].map((o) => ({ value: o.value, label: o.textContent.trim() }));
    const initial = this.getAttribute('value') ?? this.querySelector('option[selected]')?.value ?? '';
    this.#value = this.#options.some((o) => o.value === initial) ? initial : '';
    this.#render();
    document.addEventListener('click', this.onOutside);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.onOutside);
  }

  get value() { return this.#value; }
  set value(v) {
    v = String(v);
    if (!this.#options.some((o) => o.value === v)) return;
    this.#value = v;
    this.#render();
  }

  get open() { return this.hasAttribute('open'); }
  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.setAttribute('open', '');
    this.button.setAttribute('aria-expanded', 'true');
    this.#setActive(Math.max(0, this.#options.findIndex((o) => o.value === this.#value)));
  }

  close() {
    this.removeAttribute('open');
    this.button.setAttribute('aria-expanded', 'false');
  }

  #select(index) {
    const opt = this.#options[index];
    if (!opt) return;
    const changed = opt.value !== this.#value;
    this.#value = opt.value;
    this.#render();
    this.close();
    this.button.focus();
    if (changed) this.dispatchEvent(new CustomEvent('change', { detail: { value: opt.value }, bubbles: true }));
  }

  #setActive(index) {
    this.#active = index;
    this.list.querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('active', i === index);
      if (i === index) li.scrollIntoView({ block: 'nearest' });
    });
  }

  #onKey(e) {
    const last = this.#options.length - 1;
    if (!this.open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); this.show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.#setActive(Math.min(last, this.#active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.#setActive(Math.max(0, this.#active - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.#select(this.#active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { this.close(); }
  }

  #render() {
    const current = this.#options.find((o) => o.value === this.#value);
    this.labelEl.textContent = current ? current.label : (this.getAttribute('placeholder') ?? 'Chọn…');
    this.labelEl.classList.toggle('placeholder', !current);

    this.list.replaceChildren(...this.#options.map((o, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.dataset.index = i;
      li.textContent = o.label;
      li.setAttribute('aria-selected', String(o.value === this.#value));
      return li;
    }));
  }
}

customElements.define('ui-dropdown', UiDropdown);
