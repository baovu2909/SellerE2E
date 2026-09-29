module.exports = {
  permissions: {
    args: () => ['test', '--project=features', 'tests/features/permissions.spec.ts'],
    env: (p) => {
      const q = String(p.search ?? '').trim();
      if (q.length > 100) throw new Error('Từ khoá tối đa 100 ký tự');
      return q ? { PERMISSION_SEARCH: q } : {};
    },
  },
};
