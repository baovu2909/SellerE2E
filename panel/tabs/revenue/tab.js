export default {
  collect: {
    revenue(body, { $ }) {
      body.revenueFrom = $('#revenue-range').from;
      body.revenueTo = $('#revenue-range').to;
      body.revenueCreateOrder = $('#revenue-create-order').checked;
      body.revenueOrderProduct = $('#revenue-order-product').value.trim();
    },
  },
};
