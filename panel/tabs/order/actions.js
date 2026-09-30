module.exports = {
  order: {
    args: () => ['test', '--project=features', 'tests/features/order.spec.ts'],
    env: (p) => {
      const o = p.order ?? {};
      const items = (Array.isArray(o.items) ? o.items : []).map((x) => {
        const qty = Number(x.qty || 1);
        if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new Error(`Số lượng "${x.name}" phải là số nguyên 1–9999`);
        return { id: Number(x.id) || undefined, name: String(x.name).trim(), qty };
      });
      return {
        ...(o.store ? { ORDER_STORE: String(o.store).trim() } : {}),
        ...(items.length ? { ORDER_ITEMS: JSON.stringify(items) } : {}),
      };
    },
  },
};
