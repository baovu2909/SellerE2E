import { loadProducts, productNodes } from '/component/shared/sales.js';

export default {
  collect: {
    revenue(body, { $ }) {
      body.revenueFrom = $('#revenue-range').from;
      body.revenueTo = $('#revenue-range').to;
      body.revenueCreateOrder = $('#revenue-create-order').checked;
      body.revenueOrderProduct = $('#revenue-order-product').value;
      body.revenueOrderProductId = $('#revenue-order-product').node?.id ?? '';
    },
    inventory(body, { $ }) {
      body.inventoryFrom = $('#inventory-range').from;
      body.inventoryTo = $('#inventory-range').to;
      body.inventoryCreateOrder = $('#inventory-create-order').checked;
      body.inventoryCancelOrder = $('#inventory-cancel-order').checked;
      body.inventoryOrderProduct = $('#inventory-order-product').value;
      body.inventoryOrderProductId = $('#inventory-order-product').node?.id ?? '';
    },
  },

  init({ $, env, onEnvChange }) {
    const create = $('#inventory-create-order');
    const cancel = $('#inventory-cancel-order');
    const sync = () => { cancel.disabled = !create.checked; };
    create.addEventListener('change', sync);
    sync();
    customElements.whenDefined('ui-dropdown-tree').then(() => {
      const products = ['#revenue-order-product', '#inventory-order-product'].map((id) => $(id));
      for (const p of products) {
        p.loader = () => loadProducts(env()).then(productNodes);
        p.load();
      }
      onEnvChange(() => products.forEach((p) => p.load()));
    });
  },
};
