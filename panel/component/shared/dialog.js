/**
 * Hộp thoại + thông báo tự vẽ, thay cho confirm() / alert() của trình duyệt.
 *
 *   if (await ui.confirm({ title: 'Xoá tài khoản?', message: '...', okText: 'Xoá', danger: true })) { ... }
 *   ui.toast('Đã lưu tài khoản', 'success')   // 'success' | 'error' | 'info'
 *
 * Gắn vào window.ui để script thường (không phải module) trong index.html gọi được.
 * Kèm theo: mọi <input type="password"> tự có nút con mắt để hiện / ẩn mật khẩu.
 */
const ICONS = {
  success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const svg = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const style = document.createElement('style');
style.textContent = `
  .ui-overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px;
    background: rgba(15, 23, 42, .45); animation: ui-fade .15s ease-out; }
  .ui-dialog { width: 100%; max-width: 400px; background: var(--card, #fff); color: var(--text, #1f2430);
    border-radius: 14px; padding: 20px; box-shadow: 0 20px 50px rgba(15, 23, 42, .25); animation: ui-pop .18s ease-out; }
  .ui-dialog .head { display: flex; gap: 12px; align-items: flex-start; }
  .ui-dialog .ic { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
    background: #eef4ff; color: var(--primary, #1179ea); }
  .ui-dialog.danger .ic { background: #fee2e2; color: var(--danger, #dc2626); }
  .ui-dialog h3 { margin: 2px 0 4px; font-size: 16px; }
  .ui-dialog p { margin: 0; font-size: 14px; color: var(--muted, #6b7280); line-height: 1.5; word-break: break-word; }
  .ui-dialog .btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .ui-dialog .btns button { width: auto; min-width: 88px; }
  .ui-dialog.danger .btns .ok { background: var(--danger, #dc2626); }
  .ui-dialog.danger .btns .ok:hover { background: #b91c1c; }

  .ui-toasts { position: fixed; z-index: 1100; top: 72px; right: 24px; display: flex; flex-direction: column; gap: 8px;
    width: min(360px, calc(100vw - 32px)); pointer-events: none; }
  .ui-toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; padding: 12px 12px 12px 14px;
    background: var(--card, #fff); color: var(--text, #1f2430); border: 1px solid var(--border, #e3e7ee);
    border-left: 4px solid var(--primary, #1179ea); border-radius: 10px; box-shadow: 0 10px 30px rgba(15, 23, 42, .15);
    font-size: 14px; line-height: 1.45; animation: ui-slide .2s ease-out; }
  .ui-toast.success { border-left-color: var(--ok, #16a34a); } .ui-toast.success .ic { color: var(--ok, #16a34a); }
  .ui-toast.error { border-left-color: var(--danger, #dc2626); } .ui-toast.error .ic { color: var(--danger, #dc2626); }
  .ui-toast.info .ic { color: var(--primary, #1179ea); }
  .ui-toast .ic { flex: none; line-height: 0; margin-top: 1px; }
  .ui-toast .msg { flex: 1; min-width: 0; word-break: break-word; }
  .ui-toast .close { width: auto; flex: none; padding: 2px; background: none; color: var(--muted, #6b7280); line-height: 0; }
  .ui-toast .close:hover:not(:disabled) { background: none; color: var(--text, #1f2430); }
  .ui-toast.leaving { animation: ui-out .18s ease-in forwards; }

  .ui-pw { position: relative; display: block; }
  .ui-pw input { width: 100%; box-sizing: border-box; padding-right: 38px !important; }
  .ui-pw .eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; padding: 0;
    display: grid; place-items: center; background: none; color: var(--muted, #6b7280); border-radius: 6px; }
  .ui-pw .eye:hover:not(:disabled) { background: #eef2f7; color: var(--text, #1f2430); }

  @keyframes ui-fade { from { opacity: 0; } }
  @keyframes ui-pop { from { opacity: 0; transform: scale(.96) translateY(6px); } }
  @keyframes ui-slide { from { opacity: 0; transform: translateX(16px); } }
  @keyframes ui-out { to { opacity: 0; transform: translateX(16px); } }
  @media (prefers-reduced-motion: reduce) { .ui-overlay, .ui-dialog, .ui-toast, .ui-toast.leaving { animation: none; } }
`;
document.head.appendChild(style);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Hộp xác nhận. Enter = đồng ý, Esc / bấm ra ngoài = huỷ. Trả về Promise<boolean>. */
function confirm({ title = 'Xác nhận', message = '', okText = 'Đồng ý', cancelText = 'Huỷ', danger = false } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'ui-overlay';
    overlay.innerHTML = `
      <div class="ui-dialog ${danger ? 'danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="ui-d-title">
        <div class="head">
          <div class="ic">${svg(danger ? 'warn' : 'info')}</div>
          <div><h3 id="ui-d-title">${esc(title)}</h3><p>${esc(message)}</p></div>
        </div>
        <div class="btns">
          <button type="button" class="secondary cancel">${esc(cancelText)}</button>
          <button type="button" class="ok">${esc(okText)}</button>
        </div>
      </div>`;
    const done = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') {
        // Enter = bấm nút đang focus (đang ở "Huỷ" thì huỷ)
        e.preventDefault();
        done(!document.activeElement?.classList.contains('cancel'));
      }
      else if (e.key === 'Tab') {
        // giữ focus trong hộp thoại
        const btns = [...overlay.querySelectorAll('button')];
        const i = btns.indexOf(document.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
      }
    };
    overlay.addEventListener('mousedown', (e) => e.target === overlay && done(false));
    overlay.querySelector('.cancel').onclick = () => done(false);
    overlay.querySelector('.ok').onclick = () => done(true);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    overlay.querySelector(danger ? '.cancel' : '.ok').focus();
  });
}

let toastBox;
/** Thông báo nhỏ góc phải, tự tắt sau `duration` ms (lỗi giữ lâu hơn). */
function toast(message, type = 'info', duration = type === 'error' ? 6000 : 3000) {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'ui-toasts';
    toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
  }
  const item = document.createElement('div');
  item.className = `ui-toast ${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.innerHTML = `<span class="ic">${svg(type === 'success' ? 'success' : type === 'error' ? 'error' : 'info')}</span>
    <span class="msg">${esc(message)}</span>
    <button type="button" class="close" aria-label="Đóng">${svg('x', 16)}</button>`;
  let timer;
  const close = () => {
    clearTimeout(timer);
    item.classList.add('leaving');
    item.addEventListener('animationend', () => item.remove(), { once: true });
    setTimeout(() => item.remove(), 300); // phòng khi tắt hiệu ứng
  };
  item.querySelector('.close').onclick = close;
  // rê chuột vào thì dừng đếm để kịp đọc
  item.addEventListener('mouseenter', () => clearTimeout(timer));
  item.addEventListener('mouseleave', () => (timer = setTimeout(close, 1500)));
  toastBox.appendChild(item);
  timer = setTimeout(close, duration);
}

/** Thêm nút con mắt cho 1 ô mật khẩu */
function addEye(input) {
  if (input.dataset.eye) return;
  input.dataset.eye = '1';
  const wrap = document.createElement('span');
  wrap.className = 'ui-pw';
  input.replaceWith(wrap);
  wrap.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'eye';
  const render = () => {
    const shown = input.type === 'text';
    btn.innerHTML = svg(shown ? 'eyeOff' : 'eye', 18);
    btn.title = shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu';
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // giữ con trỏ trong ô
  btn.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; render(); };
  render();
  wrap.appendChild(btn);
}

document.querySelectorAll('input[type=password]').forEach(addEye);

window.ui = { confirm, toast, addEye };
