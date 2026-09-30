module.exports = {
  CATEGORY_TREE: 'categories/categories-tree?isHasLv3=true',
  PROVINCES: 'profile/provinces',
  WARDS: (provinceId) => `profile/provinces/${provinceId}/wards`,
  STORES: 'stores/search',
  POS_PRODUCTS: 'products/search-product',
};
