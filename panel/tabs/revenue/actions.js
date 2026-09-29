/** Tab Doanh thu — lệnh chạy phía server */
module.exports = {
  revenue: {
    args: () => ['test', '--project=reports', 'tests/reports/revenue-sync.spec.ts'],
    // Ô trống → khoảng ngày mặc định của trang (1 tháng gần nhất)
    env: (p) => {
      const date = (v, name) => {
        if (!v) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} phải có dạng YYYY-MM-DD`);
        return v;
      };
      const from = date(p.revenueFrom, 'Từ ngày');
      const to = date(p.revenueTo, 'Đến ngày');
      return { ...(from ? { REVENUE_FROM: from } : {}), ...(to ? { REVENUE_TO: to } : {}) };
    },
  },
};
