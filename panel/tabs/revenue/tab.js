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
  },

  init({ $, env, onEnvChange }) {
    customElements.whenDefined('ui-dropdown-tree').then(() => {
      const product = $('#revenue-order-product');
      product.loader = () => loadProducts(env()).then(productNodes);
      product.load();
      onEnvChange(() => product.load());
    });
  },
};
