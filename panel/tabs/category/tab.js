/** Tab Danh mục — tên danh mục cấp 1 / 2 / 3 (trống → mặc định trong test) */
export default {
  collect: {
    category(body, { $ }) {
      body.categoryLv1 = $('#category-lv1').value.trim();
      body.categoryLv2 = $('#category-lv2').value.trim();
      body.categoryName = $('#category-name').value.trim();
    },
  },
};
