/** Tab Vai trò — chọn vai trò cần chạy */
export default {
  collect: {
    roles(body, { $$ }) {
      body.roles = $$('#role-list input:checked').map((c) => c.value);
      if (!body.roles.length) {
        ui.toast('Chọn ít nhất 1 vai trò', 'error');
        return false; // không chạy
      }
    },
  },
};
