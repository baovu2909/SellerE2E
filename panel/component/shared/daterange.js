const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; position: relative; font: inherit; }
    .field {
      width: 100%; display: flex; align-items: center; gap: 8px; box-sizing: border-box;
      border: 1px solid var(--border, #e3e7ee); border-radius: 8px; padding: 8px 10px;
      background: var(--card, #fff); color: var(--text, #1f2430); font: inherit; font-size: 14px;
      text-align: left; cursor: pointer;
    }
    .field:hover { border-color: #c5ccd8; }
    .field:focus-visible, :host([open]) .field { outline: none; border-color: var(--primary, #1179ea); }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .label.placeholder { color: var(--muted, #6b7280); }
    svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--muted, #6b7280); }
    .clear { display: none; border: 0; background: none; padding: 0; margin: 0; width: auto; cursor: pointer; color: var(--muted, #6b7280); line-height: 0; }
    .clear:hover { color: var(--danger, #dc2626); }
    :host([has-value]) .clear { display: inline-flex; }

    .pop {
      display: none; position: absolute; z-index: 50; left: 0; top: calc(100% + 4px);
      width: 300px; box-sizing: border-box; padding: 12px;
      background: var(--card, #fff); border: 1px solid var(--border, #e3e7ee); border-radius: 12px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, .12);
    }
    :host([align=right]) .pop { left: auto; right: 0; }
    :host([open]) .pop { display: block; }

    .presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .presets button {
      border: 1px solid var(--border, #e3e7ee); background: #fff; color: var(--text, #1f2430);
      border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; width: auto;
    }
    .presets button:hover { border-color: var(--primary, #1179ea); color: var(--primary, #1179ea); }

    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .head .title { font-weight: 600; font-size: 14px; text-transform: capitalize; }
    .nav { border: 0; background: none; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; color: var(--text, #1f2430); display: inline-flex; align-items: center; justify-content: center; padding: 0; }
    .nav:hover { background: #eef2f7; }

    .grid { display: grid; grid-template-columns: repeat(7, 1fr); row-gap: 2px; }
    .dow { text-align: center; font-size: 11px; font-weight: 600; color: var(--muted, #6b7280); padding: 4px 0; }
    .day {
      border: 0; background: none; height: 34px; font: inherit; font-size: 13px; color: var(--text, #1f2430);
      cursor: pointer; padding: 0; width: 100%; border-radius: 0;
    }
    .day span { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; }
    .day:hover span { background: #eef2f7; }
    .day.out { color: #b6bcc8; }
    .day.today span { box-shadow: inset 0 0 0 1px var(--primary, #1179ea); }
    .day.in-range { background: #eef4ff; }
    .day.start { background: linear-gradient(to right, transparent 50%, #eef4ff 50%); }
    .day.end { background: linear-gradient(to left, transparent 50%, #eef4ff 50%); }
    .day.start.end { background: none; }
    .day.start span, .day.end span { background: var(--primary, #1179ea); color: #fff; font-weight: 600; }
    .day:focus-visible { outline: none; }
    .day:focus-visible span { box-shadow: 0 0 0 2px var(--primary, #1179ea); }

    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border, #e3e7ee); font-size: 12px; color: var(--muted, #6b7280); }
    .foot button { width: auto; border: 0; border-radius: 6px; padding: 5px 12px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--primary, #1179ea); color: #fff; }
    .foot button:disabled { opacity: .5; cursor: not-allowed; }
  </style>
  <div class="field" role="button" tabindex="0" aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    <span class="label"></span>
    <button type="button" class="clear" title="Xoá (dùng mặc định)" aria-label="Xoá">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="pop" role="dialog" aria-label="Chọn khoảng ngày">
    <div class="presets"></div>
    <div class="head">
      <button type="button" class="nav" data-step="-1" aria-label="Tháng trước"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button>
      <span class="title"></span>
      <button type="button" class="nav" data-step="1" aria-label="Tháng sau"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>
    <div class="grid"></div>
    <div class="foot"><span class="hint"></span><button type="button" class="done">Xong</button></div>
  </div>
`;

const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const toVn = (s) => (s ? s.split('-').reverse().join('/') : '');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function presets() {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return [
    ['Hôm nay', today, today],
    ['7 ngày', addDays(today, -6), today],
    ['30 ngày', addDays(today, -29), today],
    ['Tháng này', new Date(today.getFullYear(), today.getMonth(), 1), today],
    ['Tháng trước', new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)],
    ['Năm nay', new Date(today.getFullYear(), 0, 1), today],
  ];
}

class UiDaterange extends HTMLElement {
  #from = '';
  #to = '';
  #view = new Date(); // tháng đang xem

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(template.content.cloneNode(true));
    this.field = root.querySelector('.field');
    this.labelEl = root.querySelector('.label');
    this.pop = root.querySelector('.pop');
    this.grid = root.querySelector('.grid');
    this.titleEl = root.querySelector('.title');
    this.hintEl = root.querySelector('.hint');
    this.doneBtn = root.querySelector('.done');

    this.field.addEventListener('click', () => this.toggle());
    this.field.addEventListener('keydown', (e) => {
      if (e.target !== this.field) return;
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); this.show(); }
      if (e.key === 'Escape') this.close();
    });
    root.querySelector('.clear').addEventListener('click', (e) => { e.stopPropagation(); this.#set('', ''); });
    root.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => this.#move(Number(b.dataset.step))));
    this.doneBtn.addEventListener('click', () => { this.close(); this.field.focus(); });
    this.pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.close(); this.field.focus(); } });

    const presetBox = root.querySelector('.presets');
    presetBox.replaceChildren(...presets().map(([label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      // tính lại lúc bấm để "hôm nay" luôn đúng dù trang để mở qua đêm
      b.addEventListener('click', () => {
        const [, f, t] = presets().find(([l]) => l === label);
        this.#set(toIso(f), toIso(t));
        this.#view = new Date(t.getFullYear(), t.getMonth(), 1);
        this.close();
      });
      return b;
    }));

    this.grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.day');
      if (btn) this.#pick(btn.dataset.date);
    });
    this.onOutside = (e) => { if (!e.composedPath().includes(this)) this.close(); };
  }

  connectedCallback() {
    this.#from = fromIso(this.getAttribute('from')) ? this.getAttribute('from') : '';
    this.#to = fromIso(this.getAttribute('to')) ? this.getAttribute('to') : '';
    const base = fromIso(this.#to || this.#from) ?? new Date();
    this.#view = new Date(base.getFullYear(), base.getMonth(), 1);
    this.#renderField();
    document.addEventListener('click', this.onOutside);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.onOutside);
  }

  get from() { return this.#from; }
  get to() { return this.#to; }
  set from(v) { this.#from = fromIso(v) ? v : ''; this.#renderField(); }
  set to(v) { this.#to = fromIso(v) ? v : ''; this.#renderField(); }

  get open() { return this.hasAttribute('open'); }
  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.setAttribute('open', '');
    this.field.setAttribute('aria-expanded', 'true');
    this.#renderCalendar();
  }

  close() {
    if (!this.open) return;
    // Mới chọn Từ ngày mà đóng → coi như chọn đúng 1 ngày
    if (this.#from && !this.#to) this.#set(this.#from, this.#from);
    this.removeAttribute('open');
    this.field.setAttribute('aria-expanded', 'false');
  }

  #move(step) {
    this.#view = new Date(this.#view.getFullYear(), this.#view.getMonth() + step, 1);
    this.#renderCalendar();
  }

  #pick(iso) {
    if (!this.#from || this.#to) {
      // bắt đầu chọn khoảng mới
      this.#from = iso;
      this.#to = '';
      this.#renderField();
      this.#renderCalendar();
      return;
    }
    const [a, b] = iso < this.#from ? [iso, this.#from] : [this.#from, iso];
    this.#set(a, b);
    this.close();
    this.field.focus();
  }

  #set(from, to) {
    const changed = from !== this.#from || to !== this.#to;
    this.#from = from;
    this.#to = to;
    this.#renderField();
    if (this.open) this.#renderCalendar();
    if (changed && (!from || to)) {
      this.dispatchEvent(new CustomEvent('change', { detail: { from, to }, bubbles: true }));
    }
  }

  #renderField() {
    const has = Boolean(this.#from);
    this.toggleAttribute('has-value', has);
    this.labelEl.classList.toggle('placeholder', !has);
    this.labelEl.textContent = !has
      ? (this.getAttribute('placeholder') ?? 'Từ ngày – Đến ngày')
      : `${toVn(this.#from)} – ${this.#to ? toVn(this.#to) : '…'}`;
  }

  #renderCalendar() {
    const y = this.#view.getFullYear();
    const m = this.#view.getMonth();
    this.titleEl.textContent = `Tháng ${m + 1}, ${y}`;

    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7; // Thứ Hai = 0
    const start = addDays(first, -offset);
    const today = toIso(new Date());
    const from = this.#from;
    const to = this.#to;

    const cells = DOW.map((d) => {
      const el = document.createElement('div');
      el.className = 'dow';
      el.textContent = d;
      return el;
    });
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const iso = toIso(d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.dataset.date = iso;
      btn.classList.toggle('out', d.getMonth() !== m);
      btn.classList.toggle('today', iso === today);
      btn.classList.toggle('start', iso === from);
      btn.classList.toggle('end', iso === (to || from));
      btn.classList.toggle('in-range', Boolean(from && to && iso > from && iso < to));
      btn.setAttribute('aria-label', toVn(iso));
      const span = document.createElement('span');
      span.textContent = d.getDate();
      btn.appendChild(span);
      cells.push(btn);
    }
    this.grid.replaceChildren(...cells);

    this.hintEl.textContent = from && !to ? 'Chọn Đến ngày' : from ? `${toVn(from)} – ${toVn(to)}` : 'Chọn Từ ngày';
  }
}

customElements.define('ui-daterange', UiDaterange);
