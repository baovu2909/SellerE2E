/** Tab Doanh thu — khoảng ngày (trống → 1 tháng gần nhất) */
export default {
  collect: {
    revenue(body, { $ }) {
      body.revenueFrom = $('#revenue-range').from;
      body.revenueTo = $('#revenue-range').to;
    },
  },
};
