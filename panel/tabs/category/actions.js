module.exports = {
  category: {
    args: () => ['test', '--project=features', 'tests/features/category.spec.ts'],
    env: (p) => {
      const out = {};
      for (const [key, envName, label] of [['categoryLv1', 'CATEGORY_LV1', 'Cấp 1'], ['categoryLv2', 'CATEGORY_LV2', 'Cấp 2'], ['categoryName', 'CATEGORY_NAME', 'Cấp 3']]) {
        const v = String(p[key] ?? '').trim();
        if (v.length > 100) throw new Error(`Tên danh mục ${label} tối đa 100 ký tự`);
        if (v) out[envName] = v;
      }
      return out;
    },
  },
  'category-tax': {
    args: () => ['test', '--project=features', 'tests/features/category-tax.spec.ts'],
  },
};
