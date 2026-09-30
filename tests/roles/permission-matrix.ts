export type RoleKey = 'owner' | 'storeManager' | 'businessManager' | 'hrManager' | 'warehouse' | 'cashier' | 'accountant';

export interface Role {
  key: RoleKey;
  label: string;
  code: string;
  env: string;
}

export const ROLES: Role[] = [
  { key: 'owner', label: 'Owner', code: 'Admin', env: 'ROLE_OWNER' },
  { key: 'storeManager', label: 'Quản lý cửa hàng', code: 'StoreManager', env: 'ROLE_STORE_MANAGER' },
  { key: 'businessManager', label: 'Quản lý kinh doanh', code: 'BusinessManager', env: 'ROLE_BUSINESS_MANAGER' },
  { key: 'hrManager', label: 'Quản lý nhân sự', code: 'HRManager', env: 'ROLE_HR_MANAGER' },
  { key: 'warehouse', label: 'Thủ kho', code: 'WareHouseManager', env: 'ROLE_WAREHOUSE' },
  { key: 'cashier', label: 'Bán hàng', code: 'Cashier', env: 'ROLE_CASHIER' },
  { key: 'accountant', label: 'Kế toán', code: 'Accounting', env: 'ROLE_ACCOUNTANT' },
];

/**
 * Nút cần kiểm tra theo quyền: có quyền → phải THẤY + BẤM ĐƯỢC; không quyền → KHÔNG được thấy.
 *   path   : trang danh sách mở đầu tiên
 *   name   : chữ trên nút (hoặc title / tooltip của icon), không phân biệt hoa thường
 *   in     : nút nằm ở đâu — 'page' (mặc định) | 'menu' (menu "⋯ Thao tác" của dòng — dò nhiều dòng vì có nút chỉ hiện
 *            theo trạng thái) | 'row' (icon ngay trên dòng) | 'selected' (hiện sau khi tick chọn 1 dòng)
 *   detail : mở chi tiết dòng đầu trước khi tìm nút — 'menu:Xem chi tiết' (mục trong menu ⋯) | 'row:Xem chi tiết' (icon trên dòng)
 *   steps  : bấm thêm trước khi tìm nút (tên tab / nút, hoặc 'css:<selector>' — vd mở menu ☰)
 *   press  : bấm thật để thử? Mặc định: bấm nút an toàn (Thêm / Tạo / Xem / Sửa / Xuất file → mở form, trang, tải file;
 *            không lưu gì). Nút làm thay đổi dữ liệu (Xoá, Huỷ, Ký, Gửi, Phát hành, Sao chép, Lưu…) chỉ thử "bấm được"
 *            (hiện, không bị khoá, nhận được click) mà KHÔNG bấm thật.
 */
export interface ButtonCheck {
  path: string;
  name: string;
  in?: 'page' | 'menu' | 'row' | 'selected';
  detail?: string;
  steps?: string[];
  press?: boolean;
  /** nút chỉ bật khi đã nhập / sửa dữ liệu (vd "Lưu Chỉnh Sửa") → chỉ kiểm tra có hiện, không đòi bấm được */
  disabledOk?: boolean;
  /** in 'menu' | 'row': chỉ dò dòng có chữ này (vd 'Nháp' — phiếu nháp mới sửa được) */
  rowHas?: string;
  /** sau khi bấm phải tới trang có địa chỉ khớp (regex), vd '/receipt/edit/' */
  expectUrl?: string;
}

export interface Feature {
  name: string;
  roles: RoleKey[];
  page?: { path: string; title?: string; menu?: string; noBreadcrumb?: boolean };
  button?: ButtonCheck;
}

export interface FeatureGroup {
  group: string;
  features: Feature[];
}

const QLCH: RoleKey = 'storeManager';
const QLKD: RoleKey = 'businessManager';
const QLNS: RoleKey = 'hrManager';
const TK: RoleKey = 'warehouse';
const BH: RoleKey = 'cashier';
const KT: RoleKey = 'accountant';
const ALL: RoleKey[] = [QLCH, QLKD, QLNS, TK, BH, KT];

export const PERMISSIONS: FeatureGroup[] = [
  {
    group: 'Thông tin tài khoản',
    features: [
      { name: 'Thông tin chung - Cá nhân', roles: ALL, page: { path: '/profile/general', title: 'Thông tin chung', menu: 'Thông Tin Tài Khoản' } },
      { name: 'Thông tin chung - Doanh nghiệp', roles: [] },
      { name: 'Thông tin chung - Địa điểm kinh doanh (Cửa hàng mặc định)', roles: [] },
      { name: 'Tài khoản hóa đơn điện tử', roles: [KT], page: { path: '/profile/e-invoice', title: 'Tài khoản hóa đơn điện tử' } },
    ],
  },
  {
    group: 'Hóa đơn đầu ra',
    features: [
      { name: 'Danh sách hóa đơn đầu ra', roles: [KT], page: { path: '/sales', title: 'Hóa đơn đầu ra', menu: 'Hóa Đơn Đầu Ra' } },
      { name: 'Chi tiết hóa đơn đầu ra', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'Xem hóa đơn (PDF)', roles: [KT], button: { path: '/sales', detail: 'menu:Xem chi tiết', name: 'Xem hóa đơn' } },
      { name: 'Ký gửi CQT', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Ký Gửi CQT' } },
      { name: 'Hủy hóa đơn', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Hủy hóa đơn' } },
      // Đã bỏ "In hóa đơn"/"Tải hóa đơn": nút bấm "Xem hóa đơn" mở modal xem PDF, nhưng nút
      // in/tải bên trong là TOOLBAR GỐC của trình duyệt (Chrome PDF viewer, blob: URL) — không
      // nằm trong DOM trang, Playwright không thể dò thấy dù ở quyền nào (đã kiểm tra trực tiếp:
      // 0 kết quả cho mọi cách chọn, kể cả bên trong iframe). Đây cũng không phải quyền riêng của
      // app - hễ mở được "Xem hóa đơn (PDF)" ở trên thì in/tải luôn có sẵn qua trình duyệt.
      { name: 'Điều chỉnh hóa đơn điện tử', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Điều chỉnh hoá đơn' } },
      { name: 'Chỉnh sửa hóa đơn nháp', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Chỉnh sửa hóa đơn' } },
      { name: 'Sao chép hóa đơn', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Sao chép hóa đơn' } },
      { name: 'Xem lịch sử CQT', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Xem lịch sử CQT' } },
      { name: 'Tạo thông báo sai sót', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Tạo thông báo sai sót' } },
      { name: 'Tạo biên bản sai sót', roles: [KT], button: { path: '/sales', in: 'menu', name: 'Lập biên bản sai sót' } },
    ],
  },
  {
    group: 'Thông báo sai sót',
    features: [
      { name: 'Danh sách thông báo sai sót', roles: [KT], page: { path: '/error-notices', title: 'Danh sách TB sai sót', menu: 'Danh Sách TB Sai Sót' } },
      { name: 'Ký gửi CQT', roles: [KT], button: { path: '/error-notices', in: 'selected', name: 'Ký Gửi CQT' } },
      { name: 'Xóa thông báo sai sót', roles: [KT], button: { path: '/error-notices', in: 'selected', name: 'Xoá Thông Báo' } },
      { name: 'Chi tiết thông báo sai sót', roles: [KT], button: { path: '/error-notices', in: 'menu', name: 'Xem chi tiết' } },
      // Thay "In/Tải về thông báo sai sót" (nút cũ vốn nằm trong toolbar gốc trình duyệt, xem
      // giải thích ở nhóm "Hóa đơn đầu ra") bằng 1 check duy nhất: mở được "Xem hóa đơn" ở dòng
      // là đủ - in/tải sau đó luôn có sẵn qua trình duyệt, không phải quyền riêng của app.
      { name: 'Xem hóa đơn (PDF)', roles: [KT], button: { path: '/error-notices', in: 'row', name: 'Xem hóa đơn' } },
    ],
  },
  {
    group: 'Biên bản sai sót',
    features: [
      { name: 'Danh sách biên bản sai sót', roles: [KT], page: { path: '/error-record', title: 'Danh sách biên bản sai sót', menu: 'Danh Sách BB Sai Sót' } },
      { name: 'Ký biên bản', roles: [KT], button: { path: '/error-record', name: 'Ký số HSM' } },
      { name: 'Xóa biên bản', roles: [KT], button: { path: '/error-record', name: 'Xóa Biên Bản' } },
      { name: 'Chi tiết biên bản', roles: [KT], button: { path: '/error-record', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'In biên bản', roles: [KT], button: { path: '/error-record', detail: 'menu:Xem chi tiết', name: 'In hóa đơn' } },
      { name: 'Tải về biên bản (PDF)', roles: [KT], button: { path: '/error-record', detail: 'menu:Xem chi tiết', name: 'Tải PDF' } },
      { name: 'Tải lên biên bản thỏa thuận', roles: [KT], button: { path: '/error-record', in: 'menu', name: 'Tải biên bản thỏa thuận' } },
    ],
  },
  {
    group: 'Nhân sự và phân quyền',
    features: [
      { name: 'Danh sách nhân viên', roles: [QLCH, QLNS], page: { path: '/employees', title: 'Danh sách nhân viên', menu: 'Danh Sách Nhân Viên' } },
      { name: 'Thêm nhân viên', roles: [QLNS], button: { path: '/employees', name: 'Thêm Nhân Viên' } },
      { name: 'Xem chi tiết nhân viên', roles: [QLNS], button: { path: '/employees', in: 'menu', name: 'Xem chi tiết' } },
      // press:false — "Chỉnh Sửa" là tab đã active sẵn khi mở chi tiết (style bg-white/shadow-sm),
      // bấm vào không đổi trạng thái gì để kiểm tra phản ứng; chỉ cần xác nhận nút có hiện + bấm được.
      { name: 'Chỉnh sửa chi tiết nhân viên', roles: [QLNS], button: { path: '/employees', detail: 'menu:Xem chi tiết', name: 'Chỉnh Sửa', press: false } },
      { name: 'Xóa nhân viên', roles: [QLNS], button: { path: '/employees', in: 'menu', name: 'Xoá tài khoản' } },
      { name: 'Thêm cửa hàng cho nhân viên', roles: [QLNS], button: { path: '/employees', detail: 'menu:Xem chi tiết', name: 'Thêm cửa hàng' } },
      { name: 'Vô hiệu hóa tài khoản', roles: [QLNS], button: { path: '/employees', in: 'menu', name: 'Vô hiệu hóa tài khoản' } },
      { name: 'Trang phân quyền', roles: [QLCH, QLNS], page: { path: '/permissions', title: 'Phân quyền', menu: 'Phân Quyền' } },
    ],
  },
  {
    group: 'Quản lý đa cửa hàng',
    features: [
      { name: 'Trang danh sách cửa hàng', roles: [QLCH, QLNS], page: { path: '/store-manager', title: 'Danh sách cửa hàng', menu: 'Danh sách cửa hàng' } },
      { name: 'Thêm cửa hàng', roles: [QLCH], button: { path: '/store-manager', name: 'Thêm Cửa Hàng' } },
      { name: 'Xem chi tiết cửa hàng', roles: [QLCH, QLNS], button: { path: '/store-manager', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'Chỉnh sửa chi tiết cửa hàng', roles: [QLCH], button: { path: '/store-manager', detail: 'menu:Xem chi tiết', name: 'Lưu Chỉnh Sửa', disabledOk: true } },
      { name: 'Thêm nhân viên', roles: [QLNS], button: { path: '/store-manager', detail: 'menu:Xem chi tiết', steps: ['Danh Sách Nhân Viên'], name: 'Thêm Nhân Viên' } },
      { name: 'Xem danh sách nhân viên', roles: [QLCH, QLNS], button: { path: '/store-manager', detail: 'menu:Xem chi tiết', name: 'Danh Sách Nhân Viên' } },
      { name: 'Xóa nhân viên khỏi cửa hàng', roles: [QLNS], button: { path: '/store-manager', detail: 'menu:Xem chi tiết', steps: ['Danh Sách Nhân Viên'], in: 'menu', name: 'Xóa' } },
      // disabledOk:true - nút luôn khoá với cửa hàng mặc định (title="Không thể xoá cửa hàng mặc
      // định"), không liên quan quyền; dòng đầu danh sách thường là cửa hàng mặc định.
      { name: 'Xóa cửa hàng', roles: [], button: { path: '/store-manager', in: 'menu', name: 'Xóa cửa hàng', disabledOk: true } },
    ],
  },
  {
    group: 'Đơn hàng',
    features: [
      { name: 'Danh sách đơn hàng', roles: [QLCH, BH], page: { path: '/orders', title: 'Đơn hàng', menu: 'Đơn Hàng' } },
      { name: 'Xem chi tiết đơn hàng', roles: [QLCH, BH], button: { path: '/orders', in: 'row', name: 'Xem chi tiết' } },
      { name: 'Xuất excel đơn hàng theo bộ lọc', roles: [QLCH], button: { path: '/orders', name: 'Xuất File Excel' } },
      { name: 'Action Gửi qua AMFTax', roles: [], button: { path: '/orders', in: 'row', name: 'Gửi qua AMF Tax' } },
      { name: 'Action phát hành hóa đơn', roles: [], button: { path: '/orders', in: 'selected', name: 'Phát Hành Hóa Đơn' } },
      { name: 'In đơn hàng', roles: [BH], button: { path: '/orders', detail: 'row:Xem chi tiết', name: 'In hóa đơn' } },
      { name: 'Hủy đơn hàng', roles: [QLCH], button: { path: '/orders', detail: 'row:Xem chi tiết', name: 'Hủy đơn hàng' } },
      { name: 'Sao chép đơn hàng', roles: [BH], button: { path: '/orders', detail: 'row:Xem chi tiết', name: 'Sao chép đơn hàng' } },
    ],
  },
  {
    group: 'Danh mục',
    features: [
      { name: 'Danh sách danh mục sản phẩm', roles: [QLKD], page: { path: '/categories', title: 'Danh mục', menu: 'Danh Mục' } },
      { name: 'Thêm danh mục', roles: [QLKD], button: { path: '/categories', name: 'Thêm danh mục' } },
      { name: 'Chỉnh sửa danh mục', roles: [QLKD], button: { path: '/categories', in: 'row', name: 'Sửa' } },
    ],
  },
  {
    group: 'Sản phẩm',
    features: [
      { name: 'Danh sách sản phẩm', roles: [QLCH, QLKD, TK], page: { path: '/product', title: 'Sản phẩm', menu: 'Sản Phẩm' } },
      { name: 'In mã tem vạch', roles: [QLCH, QLKD, TK], page: { path: '/product/barcode-print', title: 'In Tem Mã Vạch' }, button: { path: '/product', name: 'In Tem Mã Vạch' } },
      { name: 'Tạo sản phẩm', roles: [QLCH, QLKD, TK], page: { path: '/product/add', title: 'Thêm Sản Phẩm' }, button: { path: '/product', name: 'Thêm Sản Phẩm Mới' } },
      { name: 'Nhập file sản phẩm', roles: [QLCH, QLKD, TK], button: { path: '/product', steps: ['css:.list-menu-wrapper amf-button button'], name: 'Nhập sản phẩm' } },
      { name: 'Xuất file sản phẩm', roles: [QLCH, QLKD, TK], button: { path: '/product', steps: ['css:.list-menu-wrapper amf-button button'], name: 'Xuất sản phẩm' } },
      { name: 'Xem chi tiết sản phẩm', roles: [QLCH, QLKD, TK], button: { path: '/product', in: 'menu', name: 'Chỉnh sửa' } },
      { name: 'Chỉnh sửa chi tiết sản phẩm', roles: [QLCH, QLKD, TK], button: { path: '/product', in: 'menu', name: 'Chỉnh sửa' } },
    ],
  },
  {
    group: 'Quản lý kho',
    features: [
      { name: 'Kho hàng - Danh sách kho hàng', roles: [QLCH, TK], page: { path: '/inventory/warehouse', title: 'Kho hàng', menu: 'Quản Lý Kho' } },
      { name: 'Kho hàng - Xuất file', roles: [TK], button: { path: '/inventory/warehouse', name: 'Xuất File Excel' } },
      { name: 'Sổ xuất kho - Danh sách phiếu xuất kho', roles: [QLCH, TK], page: { path: '/inventory/export-book', title: 'Sổ Xuất Kho' } },
      { name: 'Sổ xuất kho - Chi tiết phiếu xuất kho', roles: [QLCH, TK], button: { path: '/inventory/export-book', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'Sổ xuất kho - Chỉnh sửa phiếu xuất kho', roles: [TK], button: { path: '/inventory/export-book', in: 'menu', name: 'Huỷ phiếu' } },
      { name: 'Sổ xuất kho - Xuất file', roles: [TK], button: { path: '/inventory/export-book', name: 'Xuất File Excel' } },
      { name: 'Sổ xuất kho - Tạo phiếu xuất', roles: [TK], button: { path: '/inventory/export-book', name: 'Tạo Phiếu Xuất Kho' } },
      { name: 'Sổ nhập kho - Danh sách phiếu nhập kho', roles: [QLCH, TK], page: { path: '/inventory/receipt', title: 'Sổ Nhập Kho' } },
      { name: 'Sổ nhập kho - Chi tiết phiếu nhập kho', roles: [QLCH, TK], button: { path: '/inventory/receipt', in: 'menu', name: 'Xem chi tiết' } },
      // Sửa phiếu nhập = "Xem chi tiết" ở phiếu Nháp → mở /inventory/receipt/edit/<mã> (form sửa được)
      { name: 'Sổ nhập kho - Chỉnh sửa phiếu nhập kho', roles: [TK], button: { path: '/inventory/receipt', in: 'menu', rowHas: 'Nháp', name: 'Xem chi tiết', expectUrl: '/inventory/receipt/edit/' } },
      { name: 'Sổ nhập kho - Gửi qua AMF Tax', roles: [TK], button: { path: '/inventory/receipt', in: 'selected', name: 'Gửi Qua AMF Tax' } },
      { name: 'Sổ nhập kho - Xuất file excel', roles: [TK], button: { path: '/inventory/receipt', name: 'Xuất File Excel' } },
      { name: 'Sổ nhập kho - Tạo phiếu nhập kho', roles: [TK], button: { path: '/inventory/receipt', name: 'Tạo Phiếu Nhập Kho' } },
      { name: 'Kiểm kho - Danh sách phiếu kiểm kho', roles: [QLCH, TK], page: { path: '/inventory/inventory-audit', title: 'Kiểm Kho' } },
      { name: 'Kiểm kho - Chi tiết phiếu kiểm kho', roles: [QLCH, TK], button: { path: '/inventory/inventory-audit', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'Kiểm kho - Chỉnh sửa phiếu kiểm kho', roles: [TK], button: { path: '/inventory/inventory-audit', in: 'menu', name: 'Hủy phiếu' } },
      { name: 'Kiểm kho - Tạo phiếu kiểm kho', roles: [TK], button: { path: '/inventory/inventory-audit', name: 'Tạo Phiếu Kiểm Kho' } },
      { name: 'Kiểm kho - Xuất file excel', roles: [TK], button: { path: '/inventory/inventory-audit', name: 'Xuất File Excel' } },
      { name: 'Chuyển kho - Danh sách phiếu chuyển kho', roles: [QLCH, TK], page: { path: '/inventory/transfer', title: 'Chuyển Kho' } },
      { name: 'Chuyển kho - Chi tiết phiếu chuyển kho', roles: [QLCH, TK], button: { path: '/inventory/transfer', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'Chuyển kho - Chỉnh sửa phiếu chuyển kho', roles: [TK], button: { path: '/inventory/transfer', in: 'menu', name: 'Huỷ phiếu' } },
      { name: 'Chuyển kho - Gửi qua AMF Tax', roles: [TK], button: { path: '/inventory/transfer', in: 'selected', name: 'Gửi Qua AMF Tax' } },
      { name: 'Chuyển kho - Tạo phiếu chuyển kho', roles: [TK], button: { path: '/inventory/transfer', name: 'Tạo Phiếu Chuyển Kho' } },
      { name: 'Chuyển kho - Xuất file excel', roles: [TK], button: { path: '/inventory/transfer', name: 'Xuất File Excel' } },
      { name: 'Sổ kho - Danh sách sổ kho', roles: [QLCH, TK], page: { path: '/inventory/inventory-ledger', title: 'Sổ Kho' } },
    ],
  },
  {
    group: 'Chương trình khuyến mãi',
    features: [
      { name: 'Danh sách chương trình khuyến mãi', roles: [QLCH, QLKD], page: { path: '/promotion', title: 'Chương Trình Khuyến Mãi', menu: 'Chương Trình Khuyến Mãi' } },
      { name: 'Xem chi tiết chương trình khuyến mãi', roles: [QLKD], button: { path: '/promotion', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'Sao chép chương trình khuyến mãi', roles: [QLKD], button: { path: '/promotion', in: 'menu', name: 'Sao chép' } },
      { name: 'Chỉnh sửa chương trình khuyến mãi', roles: [QLKD], button: { path: '/promotion', in: 'menu', name: 'Tiếp tục' } },
      { name: 'Xóa khuyến mãi', roles: [QLKD], button: { path: '/promotion', in: 'menu', name: 'Xóa' } },
      { name: 'Hủy khuyến mãi', roles: [QLKD], button: { path: '/promotion', detail: 'menu:Xem chi tiết', name: 'Tạm Dừng Khuyến Mãi' } },
      { name: 'Tạo chương trình khuyến mãi', roles: [QLKD], button: { path: '/promotion', name: 'Tạo Khuyến Mãi' } },
    ],
  },
  {
    group: 'Mã khuyến mãi',
    features: [
      { name: 'Danh sách mã khuyến mãi', roles: [QLCH, QLKD], page: { path: '/promotion-code', title: 'Mã Khuyến Mãi', menu: 'Mã Khuyến Mãi' } },
      { name: 'Xem chi tiết mã khuyến mãi', roles: [QLKD], button: { path: '/promotion-code', in: 'menu', name: 'Xem chi tiết' } },
      { name: 'Sao chép mã khuyến mãi', roles: [QLKD], button: { path: '/promotion-code', in: 'menu', name: 'Sao chép' } },
      { name: 'Chỉnh sửa mã khuyến mãi', roles: [QLKD], button: { path: '/promotion-code', in: 'menu', name: 'Tiếp tục' } },
      { name: 'Xóa mã khuyến mãi', roles: [QLKD], button: { path: '/promotion-code', in: 'menu', name: 'Xóa' } },
      { name: 'Hủy mã khuyến mãi', roles: [QLKD], button: { path: '/promotion-code', detail: 'menu:Xem chi tiết', name: 'Tạm Dừng Mã Khuyến Mãi' } },
      { name: 'Tạo mã khuyến mãi', roles: [QLKD], button: { path: '/promotion-code', name: 'Tạo Mã Khuyến Mãi' } },
    ],
  },
  {
    group: 'Sổ nợ',
    features: [
      { name: 'Danh sách sổ nợ', roles: [QLCH, KT], page: { path: '/customer-debt', title: 'Sổ nợ', menu: 'Sổ Nợ' } },
      { name: 'Xuất file sổ nợ', roles: [KT], button: { path: '/customer-debt', name: 'Xuất file' } },
      { name: 'Action - tôi đã đưa', roles: [KT], button: { path: '/customer-debt', name: 'Tôi đã đưa' } },
      { name: 'Action - tôi đã nhận', roles: [KT], button: { path: '/customer-debt', name: 'Tôi đã nhận' } },
      { name: 'Action - thanh toán', roles: [KT], button: { path: '/customer-debt', in: 'row', name: 'Thanh toán' } },
    ],
  },
  {
    group: 'Thu chi',
    features: [
      { name: 'Danh sách phiếu thu chi', roles: [QLCH, KT], page: { path: '/income-expense', title: 'Thu chi', menu: 'Thu Chi' } },
      { name: 'Xem chi tiết phiếu thu chi', roles: [KT], button: { path: '/income-expense', in: 'row', name: 'Xem chi tiết' } },
      { name: 'Action - khoản chi', roles: [KT], button: { path: '/income-expense', name: 'Khoản chi' } },
      { name: 'Action - khoản thu', roles: [KT], button: { path: '/income-expense', name: 'Khoản thu' } },
    ],
  },
  {
    group: 'Danh bạ',
    features: [
      { name: 'Danh sách khách hàng', roles: [QLCH, QLKD, BH], page: { path: '/customers', title: 'Quản lý khách hàng', menu: 'Danh Bạ' } },
      { name: 'Chi tiết khách hàng', roles: [QLCH, QLKD, BH], button: { path: '/customers', in: 'row', name: 'Chi tiết' } },
      { name: 'Chỉnh sửa khách hàng', roles: [QLCH, QLKD, BH], button: { path: '/customers', in: 'row', name: 'Chỉnh sửa' } },
      { name: 'Thêm mới khách hàng', roles: [QLCH, QLKD, BH], button: { path: '/customers', name: 'Thêm khách hàng' } },
    ],
  },
  {
    group: 'Thống kê và báo cáo',
    features: [
      { name: 'Xem báo cáo và thống kê', roles: [QLCH, QLKD, QLNS], page: { path: '/reports', title: 'Báo cáo', menu: 'Báo Cáo' } },
      { name: 'Xem báo cáo - Quản lý dòng tiền', roles: [QLCH, QLKD,QLNS], page: { path: '/cash', title: 'Dòng tiền', menu: 'Quản Lý Dòng Tiền' } },
      { name: 'Xem báo cáo - Lãi lỗ', roles: [QLCH, QLKD,QLNS], page: { path: '/profit-and-loss-report', title: 'Lợi nhuận và lỗ', menu: 'Lãi Lỗ' } },
      { name: 'Xuất file báo cáo', roles: [QLKD,QLNS] },
    ],
  },
  {
    group: 'Cấu hình chung',
    features: [
      { name: 'Phương thức thanh toán', roles: [KT], page: { path: '/configuration/payment-method', title: 'Phương thức thanh toán', menu: 'Cấu Hình Chung' } },
      { name: 'Định dạng hiển thị số', roles: [KT], page: { path: '/configuration/number-format', title: 'Định dạng hiển thị số' } },
      { name: 'Tự động ký CQT', roles: [KT], page: { path: '/configuration/auto-assign-config', title: 'Tự động ký gửi CQT' } },
      { name: 'Thiết lập thuế', roles: [KT], page: { path: '/configuration/tax-manager', title: 'Thiết lập thuế' } },
    ],
  },
  {
    group: 'Hỗ trợ',
    features: [{ name: 'Hỗ trợ', roles: [QLCH, QLKD, QLNS], page: { path: '/support', title: 'Hỗ trợ', menu: 'Hỗ Trợ' } }],
  },
  {
    group: 'Bán hàng tại quầy',
    features: [
      { name: 'Bán hàng tại quầy', roles: [BH], page: { path: '/sale-on-place', noBreadcrumb: true } },
      { name: 'Nút "Bán hàng tại quầy" trên header', roles: [BH], button: { path: '/profile/general', name: 'Bán hàng tại quầy' } },
    ],
  },
];

export const isAllowed = (feature: Feature, role: RoleKey) => role === 'owner' || feature.roles.includes(role);
