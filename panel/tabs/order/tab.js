import { loadProducts, loadStores, productNodes, storeNodes } from '/component/shared/sales.js';

export default {
  collect: {
    order(body, { $, $$ }) {
      body.order = {
        store: $('#o-store').value,
        items: $$('#o-items .store-row')
          .map((r) => ({ id: r.querySelector('ui-dropdown-tree').node?.id, name: r.querySelector('ui-dropdown-tree').value, qty: r.querySelector('.qty').value.trim() }))
          .filter((x) => x.name),
      };
      const stock = $$('#o-items .store-row').map((r) => [r.querySelector('ui-dropdown-tree').node, Number(r.querySelector('.qty').value || 1)]);
      const over = stock.find(([n, q]) => n && n.stock !== null && q > n.stock);
      if (over) {
        ui.toast(`"${over[0].name}" chỉ còn ${over[0].stock} trong kho`, 'error');
        return false;
      }
    },
  },

  init({ $, el, icon, env, onEnvChange, refreshIcons }) {
    customElements.whenDefined('ui-dropdown-tree').then(() => {
      const store = $('#o-store');
      const storeId = () => (store.node?.isDefault ? '' : store.node?.id ?? '');
      const productLoader = () => loadProducts(env(), storeId()).then(productNodes);

      store.loader = async () => {
        const list = storeNodes(await loadStores(env()));
        store.defaultPath = [list.find((s) => s.isDefault)?.name ?? ''];
        return list;
      };
      store.addEventListener('change', () => {
        for (const dd of $('#o-items').querySelectorAll('ui-dropdown-tree')) {
          dd.loader = productLoader;
          dd.load();
        }
      });

      function addRow() {
        const product = el('ui-dropdown-tree');
        product.setAttribute('noun', 'sản phẩm');
        product.setAttribute('placeholder', 'Chọn sản phẩm');
        const del = el('button', { type: 'button', className: 'del-store', title: 'Bỏ sản phẩm này' }, [icon('x')]);
        const row = el('div', { className: 'store-row' }, [
          product,
          el('input', { type: 'number', className: 'qty', min: 1, placeholder: 'SL', value: 1 }),
          del,
        ]);
        del.onclick = () => row.remove();
        $('#o-items').append(row);
        product.loader = productLoader;
        product.load();
        refreshIcons();
      }
      $('#o-add-item').addEventListener('click', addRow);

      store.load();
      onEnvChange(() => store.load());
    });
  },
};
