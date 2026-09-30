// mặc định giống tests/features/category.spec.ts
const DEFAULT_PATH = ['Thiết bị điện tử', 'Bộ phận máy tính'];
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export default {
  collect: {
    category(body, { $ }) {
      const parent = $('#category-parent');
      [body.categoryLv1 = '', body.categoryLv2 = ''] = parent.path;
      body.categoryName = $('#category-name').value.trim();
      if (body.categoryName && parent.node?.children.some((c) => norm(c.name) === norm(body.categoryName))) {
        ui.toast(`"${body.categoryName}" đã có trong ${body.categoryLv2} — đổi tên khác hoặc để trống`, 'error');
        return false;
      }
    },
  },

  async init({ $, env, onEnvChange }) {
    await customElements.whenDefined('ui-dropdown-categories');
    const parent = $('#category-parent');
    parent.defaultPath = DEFAULT_PATH;
    parent.env = env();
    onEnvChange((e) => (parent.env = e));
  },
};
