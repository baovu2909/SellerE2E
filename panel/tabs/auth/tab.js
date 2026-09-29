export default {
  collect: {
    lockout(body, { $ }) {
      body.lockUser = $('#lock-user').value.trim();
      body.lockPass = $('#lock-pass').value;
    },
  },

  init(ctx) {
    const { $, el, icon, env } = ctx;

    function renderAccounts({ active = '', list = [] }) {
      const row = (username, label, extra) => {
        const isActive = username === active;
        const item = el('div', { className: 'acc' + (isActive ? ' active' : ''), title: isActive ? 'Đang dùng' : 'Bấm để dùng tài khoản này' }, [
          icon(isActive ? 'circle-check' : 'circle'),
          el('span', { className: 'name' }, label),
        ]);
        if (extra) item.append(extra);
        item.onclick = async () => {
          if (isActive) return;
          if (await saveAccount({ op: 'use', username })) ui.toast(`Đang dùng: ${username || 'tài khoản trong file env'}`, 'success');
        };
        return item;
      };
      const items = list.map((u) => {
        const del = el('button', { type: 'button', className: 'del', title: `Xoá ${u}` }, [icon('x')]);
        del.onclick = async (e) => {
          e.stopPropagation();
          const ok = await ui.confirm({
            title: 'Xoá tài khoản?',
            message: `Xoá "${u}" khỏi danh sách tài khoản đã lưu (${env()}). Tài khoản thật trên hệ thống không bị ảnh hưởng.`,
            okText: 'Xoá',
            danger: true,
          });
          if (ok && (await saveAccount({ op: 'remove', username: u }))) ui.toast(`Đã xoá tài khoản "${u}"`, 'success');
        };
        return row(u, [u], del);
      });
      items.push(row('', [el('span', { className: 'muted', textContent: 'Theo file env (SELLER_USERNAME)' })]));
      $('#acc-list').replaceChildren(...items);
      $('#hdr-acc span').textContent = active || 'Theo file env';
      ctx.refreshIcons();
    }

    async function loadAccounts() {
      try { renderAccounts(await (await fetch(`/accounts?env=${env()}`)).json()); } catch {}
    }

    async function saveAccount(payload) {
      let res, data;
      try {
        res = await fetch('/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env: env(), ...payload }) });
        data = await res.json();
      } catch {
        ui.toast('Mất kết nối tới server', 'error');
        return false;
      }
      if (!res.ok) { ui.toast(data.error, 'error'); return false; }
      renderAccounts(data);
      return true;
    }

    $('#acc-add').addEventListener('click', async () => {
      // xoá ô ngay khi bấm (để gõ tiếp tài khoản khác), lưu lỗi thì trả lại
      const username = $('#acc-user').value.trim(), password = $('#acc-pass').value;
      $('#acc-user').value = ''; $('#acc-pass').value = '';
      if (await saveAccount({ op: 'add', username, password })) ui.toast(`Đã lưu và chọn tài khoản "${username}"`, 'success');
      else if (!$('#acc-user').value && !$('#acc-pass').value) { $('#acc-user').value = username; $('#acc-pass').value = password; }
    });
    $('#acc-pass').addEventListener('keydown', (e) => e.key === 'Enter' && $('#acc-add').click());
    // tên tài khoản trên header → mở tab Đăng nhập
    $('#hdr-acc').addEventListener('click', () => ctx.showGroup('auth'));
    ctx.onEnvChange(loadAccounts);
    loadAccounts();
  },
};
