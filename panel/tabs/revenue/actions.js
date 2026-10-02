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
      const product = String(p.revenueOrderProduct || '').trim();
      if (product.length > 200) throw new Error('Tên sản phẩm để tạo đơn quá dài');
      return {
        ...(from ? { REVENUE_FROM: from } : {}),
        ...(to ? { REVENUE_TO: to } : {}),
        REVENUE_CREATE_ORDER: p.revenueCreateOrder === false ? '0' : '1',
        ...(product ? { REVENUE_ORDER_PRODUCT: product } : {}),
        ...(Number(p.revenueOrderProductId) ? { REVENUE_ORDER_PRODUCT_ID: String(Number(p.revenueOrderProductId)) } : {}),
      };
    },
  },
  inventory: {
    args: () => ['test', '--project=reports', 'tests/reports/inventory-report.spec.ts'],
    env: (p) => {
      const date = (v, name) => {
        if (!v) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} phải có dạng YYYY-MM-DD`);
        return v;
      };
      const from = date(p.inventoryFrom, 'Từ ngày');
      const to = date(p.inventoryTo, 'Đến ngày');
      const product = String(p.inventoryOrderProduct || '').trim();
      if (product.length > 200) throw new Error('Tên sản phẩm để tạo đơn quá dài');
      return {
        ...(from ? { INVENTORY_FROM: from } : {}),
        ...(to ? { INVENTORY_TO: to } : {}),
        INVENTORY_CREATE_ORDER: p.inventoryCreateOrder === false ? '0' : '1',
        INVENTORY_CANCEL_ORDER: p.inventoryCancelOrder === false ? '0' : '1',
        ...(product ? { INVENTORY_ORDER_PRODUCT: product } : {}),
        ...(Number(p.inventoryOrderProductId) ? { INVENTORY_ORDER_PRODUCT_ID: String(Number(p.inventoryOrderProductId)) } : {}),
      };
    },
  },
};
