/** Tab Vai trò — lệnh chạy phía server */
module.exports = {
  roles: {
    args: () => ['test', '--project=roles'],
    // p.roles: ['owner','cashier',...] — trống = mọi vai trò đã điền tài khoản trong env
    env: (p) => {
      const keys = (Array.isArray(p.roles) ? p.roles : []).filter((k) => /^[a-zA-Z]+$/.test(k));
      return keys.length ? { ROLES_ONLY: keys.join(',') } : {};
    },
  },
};
