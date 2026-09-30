/** Tab Vai trò — lệnh chạy phía server */
module.exports = {
  roles: {
    // 7 worker = 7 cửa sổ chạy cùng lúc, mỗi vai trò 1 cửa sổ
    args: () => ['test', '--project=roles', '--workers=7'],
    // p.roles: ['owner','cashier',...] — trống = mọi vai trò đã điền tài khoản trong env
    env: (p) => {
      const keys = (Array.isArray(p.roles) ? p.roles : []).filter((k) => /^[a-zA-Z]+$/.test(k));
      return keys.length ? { ROLES_ONLY: keys.join(',') } : {};
    },
  },
};
