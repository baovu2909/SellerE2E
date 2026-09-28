/**
 * Danh sách trang Seller để kiểm tra hiển thị (chỉ MỞ trang, không tạo / sửa / xoá).
 * Lấy theo menu sidebar (FE: src/app/layout/data.ts) + các trang con dạng danh sách.
 *
 * Không đưa vào đây: trang tạo/sửa (add, create, import, edit) và trang chi tiết cần ID.
 *
 *   path  : đường dẫn
 *   title : chữ phải có trong tiêu đề trang (breadcrumb, không phân biệt hoa thường). Bỏ trống = không kiểm tiêu đề
 */
export interface SellerPage {
  path: string;
  title?: string;
}

export const SELLER_PAGES: Record<string, SellerPage[]> = {
  'Hồ sơ': [
    { path: '/profile', title: 'Thông tin' },
    { path: '/profile/general', title: 'Thông tin chung' },
    { path: '/profile/e-invoice', title: 'Tài khoản hóa đơn điện tử' },
  ],
  'Hóa đơn điện tử': [
    { path: '/sales', title: 'Hóa đơn đầu ra' },
    { path: '/error-notices', title: 'Danh sách TB sai sót' },
    { path: '/error-record', title: 'Danh sách biên bản sai sót' },
  ],
  'Nhân sự & phân quyền': [
    { path: '/employees', title: 'Danh sách nhân viên' },
    { path: '/permissions', title: 'Phân quyền' },
  ],
  'Cửa hàng': [{ path: '/store-manager', title: 'Danh sách cửa hàng' }],
  'Đơn hàng': [{ path: '/orders', title: 'Đơn hàng' }],
  'Sản phẩm & kho': [
    { path: '/categories', title: 'Danh mục' },
    { path: '/product', title: 'Sản phẩm' },
    { path: '/product/barcode-print', title: 'In Tem Mã Vạch' },
    { path: '/inventory' },
    { path: '/inventory/warehouse', title: 'Kho hàng' },
    { path: '/inventory/receipt', title: 'Sổ Nhập Kho' },
    { path: '/inventory/export-book', title: 'Sổ Xuất Kho' },
    { path: '/inventory/inventory-ledger', title: 'Sổ Kho' },
    { path: '/inventory/inventory-audit', title: 'Kiểm Kho' },
    { path: '/inventory/transfer', title: 'Chuyển Kho' },
  ],
  'Khuyến mãi': [
    { path: '/promotion', title: 'Chương Trình Khuyến Mãi' },
    { path: '/promotion-code', title: 'Mã Khuyến Mãi' },
  ],
  'Tài chính': [
    { path: '/customer-debt', title: 'Sổ nợ' },
    { path: '/income-expense', title: 'Thu chi' },
  ],
  'Khách hàng / Nhà cung cấp': [{ path: '/customers', title: 'Quản lý khách hàng' }],
  'Thống kê & báo cáo': [
    { path: '/cash', title: 'Dòng tiền' },
    { path: '/reports', title: 'Báo cáo' },
    { path: '/reports/history', title: 'Lịch sử báo cáo' },
    { path: '/reports/list-report', title: 'Danh sách báo cáo' },
    { path: '/profit-and-loss-report', title: 'Lợi nhuận và lỗ' },
  ],
  'Thiết lập & hỗ trợ': [
    { path: '/configuration/payment-method', title: 'Phương thức thanh toán' },
    { path: '/configuration/number-format', title: 'Định dạng hiển thị số' },
    { path: '/configuration/auto-assign-config', title: 'Tự động ký gửi CQT' },
    { path: '/configuration/tax-manager', title: 'Thiết lập thuế' },
    { path: '/support', title: 'Hỗ trợ' },
    { path: '/change-password', title: 'Đổi mật khẩu' },
  ],
};
