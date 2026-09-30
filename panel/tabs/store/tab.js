import { loadProvinces, loadWards } from '/component/shared/locations.js';

// mặc định giống tests/features/store.spec.ts
const DEFAULT_PROVINCE = 'Thành phố Hà Nội';

export default {
  collect: {
    store(body, { $ }) {
      const v = (id) => $(id).value.trim();
      body.store = {
        name: v('#s-name'), count: v('#s-count'), code: v('#s-code'), hotline: v('#s-hotline'), email: v('#s-email'),
        address: v('#s-address'), province: v('#s-province'), ward: v('#s-ward'),
        editName: v('#s-edit-name'), editHotline: v('#s-edit-hotline'), editEmail: v('#s-edit-email'),
      };
    },
  },

  init({ $, prefs, env, onEnvChange }) {
    const saved = prefs.get('store') ?? {};
    if (saved.count) $('#s-count').value = saved.count;
    const update = () => {
      const base = $('#s-name').value.trim() || 'Cửa hàng test';
      const n = Number($('#s-count').value);
      // nhiều cửa hàng: số nối tiếp số lớn nhất đang có (vd đã có "… 30" → 31, 32…)
      const preview = $('#s-preview');
      if (preview) preview.textContent = n > 1 ? `${n} cửa hàng: "${base} <số tiếp theo>" × ${n}` : `1 cửa hàng: "${base}"`;
      prefs.set('store', { count: $('#s-count').value });
    };
    ['#s-name', '#s-count'].forEach((id) => $(id).addEventListener('input', update));
    update();

    customElements.whenDefined('ui-dropdown-tree').then(() => {
      const province = $('#s-province');
      const ward = $('#s-ward');
      province.defaultPath = [DEFAULT_PROVINCE];
      province.loader = () => loadProvinces(env());
      const loadWardList = () => {
        const id = province.node?.id;
        ward.loader = id ? () => loadWards(env(), id) : async () => [];
        ward.load();
      };
      province.addEventListener('change', loadWardList);
      province.load();
      onEnvChange(() => province.load());
    });
  },
};
