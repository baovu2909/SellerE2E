/**
 * Tab Sản phẩm — ô nhập thông tin sản phẩm, danh sách cửa hàng + tồn kho, ảnh, file Excel nhập.
 * Chọn "Dịch vụ" → ẩn Giá vốn và cột Số lượng (dịch vụ không có giá vốn / tồn kho).
 */
async function collectProduct(body, ctx) {
  const { $, $$ } = ctx;
  const v = (id) => $(id).value.trim();
  body.product = {
    name: v('#p-name'), code: v('#p-code'), sku: v('#p-sku'), category: v('#p-category'),
    type: $('#p-type').value, shortDesc: v('#p-short'), cost: v('#p-cost'), price: v('#p-price'),
    unit: v('#p-unit'), editName: v('#p-edit-name'), editPrice: v('#p-edit-price'),
    // [{ name, qty }] — bỏ dòng trống tên
    stores: $$('#p-stores .store-row')
      .map((r) => ({ name: r.querySelector('.store-name').value.trim(), qty: r.querySelector('.qty').value.trim() }))
      .filter((s) => s.name),
  };
  try {
    body.uploads = { images: await $('#p-images').toPayload(), importFile: (await $('#p-import').toPayload())[0] ?? null };
  } catch (e) {
    ui.toast('Không đọc được file đã chọn: ' + e.message, 'error');
    return false;
  }
}

export default {
  collect: {
    product: collectProduct,
    async 'product-import'(body, ctx) {
      if ((await collectProduct(body, ctx)) === false) return false;
      if (!body.uploads.importFile) ui.toast('Chưa chọn file Excel — chỉ kiểm tra tải file mẫu', 'info');
    },
  },

  init(ctx) {
    const { $, el, icon } = ctx;

    customElements.whenDefined('ui-dropdown-categories').then(() => {
      const category = $('#p-category');
      category.env = ctx.env();
      ctx.onEnvChange((e) => (category.env = e));
    });

    function addStoreRow(name = '', qty = '') {
      const del = el('button', { type: 'button', className: 'del-store', title: 'Bỏ cửa hàng này' }, [icon('x')]);
      const row = el('div', { className: 'store-row' }, [
        el('input', { type: 'text', className: 'store-name', placeholder: 'Tên cửa hàng', value: name, maxLength: 100, autocomplete: 'off' }),
        el('input', { type: 'text', className: 'qty', inputMode: 'numeric', placeholder: 'Số lượng', value: qty, autocomplete: 'off' }),
        del,
      ]);
      del.onclick = () => row.remove();
      $('#p-stores').append(row);
      ctx.refreshIcons();
      row.querySelector('.store-name').focus();
    }
    $('#p-add-store').addEventListener('click', () => addStoreRow());

    const card = $('#p-type').closest('.card');
    const syncType = () => card.classList.toggle('is-service', ($('#p-type').value ?? $('#p-type').getAttribute('value')) === 'dich-vu');
    $('#p-type').addEventListener('change', syncType);
    syncType();
  },
};
