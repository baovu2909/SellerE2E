import { PERMISSIONS, RoleKey, isAllowed } from './permission-matrix';

/**
 * Trang "Quản Lý Phân Quyền" (/permissions) gộp nhiều chức năng của matrix thành 1 dòng.
 * Mỗi dòng: nhóm + tên dòng trên trang → các chức năng trong PERMISSIONS ('Nhóm › Tên chức năng').
 * Trang ghi "có quyền" ⇔ matrix cho vai trò ít nhất 1 chức năng trong danh sách.
 * features rỗng = matrix chưa có → test chỉ cảnh báo ⚠, không so.
 */
export interface PageRow {
  group: string;
  resource: string;
  features: string[];
}

export const PERMISSION_PAGE: PageRow[] = [
  { group: 'THÔNG TIN TÀI KHOẢN', resource: 'Thông tin chung', features: ['Thông tin tài khoản › Thông tin chung - Cá nhân'] },
  { group: 'THÔNG TIN TÀI KHOẢN', resource: 'Tài khoản ngân hàng', features: [] },
  { group: 'THÔNG TIN TÀI KHOẢN', resource: 'Tài khoản hóa đơn điện tử', features: ['Thông tin tài khoản › Tài khoản hóa đơn điện tử'] },

  { group: 'HOÁ ĐƠN ĐẦU RA', resource: 'Tìm kiếm, xem danh sách, xem chi tiết hoá đơn đầu ra', features: ['Hóa đơn đầu ra › Danh sách hóa đơn đầu ra', 'Hóa đơn đầu ra › Chi tiết hóa đơn đầu ra', 'Hóa đơn đầu ra › Xem hóa đơn (PDF)'] },
  { group: 'HOÁ ĐƠN ĐẦU RA', resource: 'Chỉnh sửa, cập nhật trạng thái danh sách hoá đơn đầu ra', features: ['Hóa đơn đầu ra › Ký gửi CQT', 'Hóa đơn đầu ra › Hủy hóa đơn', 'Hóa đơn đầu ra › Điều chỉnh hóa đơn điện tử', 'Hóa đơn đầu ra › Chỉnh sửa hóa đơn nháp', 'Hóa đơn đầu ra › Sao chép hóa đơn', 'Hóa đơn đầu ra › Tạo thông báo sai sót', 'Hóa đơn đầu ra › Tạo biên bản sai sót'] },
  { group: 'HOÁ ĐƠN ĐẦU RA', resource: 'Xuất file/in danh sách hoá đơn đầu ra', features: ['Hóa đơn đầu ra › In hóa đơn', 'Hóa đơn đầu ra › Tải hóa đơn'] },

  { group: 'DANH SÁCH TB SAI SÓT', resource: 'Tìm kiếm, xem danh sách, xem chi tiết thông báo sai sót', features: ['Thông báo sai sót › Danh sách thông báo sai sót', 'Thông báo sai sót › Chi tiết thông báo sai sót'] },
  { group: 'DANH SÁCH TB SAI SÓT', resource: 'Cập nhật trạng thái danh sách thông báo sai sót', features: ['Thông báo sai sót › Ký gửi CQT', 'Thông báo sai sót › Xóa thông báo sai sót'] },
  { group: 'DANH SÁCH TB SAI SÓT', resource: 'Xuất file/in danh sách thông báo sai sót', features: ['Thông báo sai sót › In thông báo sai sót', 'Thông báo sai sót › Tải về thông báo sai sót'] },

  { group: 'DANH SÁCH BB SAI SÓT', resource: 'Tìm kiếm, xem danh sách, xem chi tiết biên bản sai sót', features: ['Biên bản sai sót › Danh sách biên bản sai sót', 'Biên bản sai sót › Chi tiết biên bản'] },
  { group: 'DANH SÁCH BB SAI SÓT', resource: 'Chỉnh sửa, cập nhật trạng thái danh sách biên bản sai sót', features: ['Biên bản sai sót › Ký biên bản', 'Biên bản sai sót › Xóa biên bản', 'Biên bản sai sót › Tải lên biên bản thỏa thuận'] },
  { group: 'DANH SÁCH BB SAI SÓT', resource: 'Xuất file/in danh sách biên bản sai sót', features: ['Biên bản sai sót › In biên bản', 'Biên bản sai sót › Tải về biên bản (PDF)'] },

  { group: 'NHÂN SỰ & PHÂN QUYỀN', resource: 'Tìm kiếm, xem danh sách nhân sự và phân quyền', features: ['Nhân sự và phân quyền › Danh sách nhân viên', 'Nhân sự và phân quyền › Xem chi tiết nhân viên', 'Nhân sự và phân quyền › Trang phân quyền'] },
  { group: 'NHÂN SỰ & PHÂN QUYỀN', resource: 'Tạo, chỉnh sửa danh sách nhân sự và phân quyền', features: ['Nhân sự và phân quyền › Thêm nhân viên', 'Nhân sự và phân quyền › Chỉnh sửa chi tiết nhân viên', 'Nhân sự và phân quyền › Xóa nhân viên', 'Nhân sự và phân quyền › Thêm cửa hàng cho nhân viên', 'Nhân sự và phân quyền › Vô hiệu hóa tài khoản'] },

  { group: 'SẢN PHẨM & KHO', resource: 'Xuất/Nhập sản phẩm', features: ['Sản phẩm › Nhập file sản phẩm', 'Sản phẩm › Xuất file sản phẩm'] },
  { group: 'SẢN PHẨM & KHO', resource: 'In tem mã vạch', features: ['Sản phẩm › In mã tem vạch'] },
  { group: 'SẢN PHẨM & KHO', resource: 'Danh mục', features: ['Danh mục › Danh sách danh mục sản phẩm', 'Danh mục › Thêm danh mục', 'Danh mục › Chỉnh sửa danh mục'] },
  { group: 'SẢN PHẨM & KHO', resource: 'Sản phẩm', features: ['Sản phẩm › Danh sách sản phẩm', 'Sản phẩm › Tạo sản phẩm', 'Sản phẩm › Xem chi tiết sản phẩm', 'Sản phẩm › Chỉnh sửa chi tiết sản phẩm'] },
  { group: 'SẢN PHẨM & KHO', resource: 'Kho hàng', features: ['Quản lý kho › Kho hàng - Danh sách kho hàng', 'Quản lý kho › Sổ xuất kho - Danh sách phiếu xuất kho', 'Quản lý kho › Sổ nhập kho - Danh sách phiếu nhập kho', 'Quản lý kho › Kiểm kho - Danh sách phiếu kiểm kho', 'Quản lý kho › Chuyển kho - Danh sách phiếu chuyển kho', 'Quản lý kho › Sổ kho - Danh sách sổ kho'] },

  { group: 'CHƯƠNG TRÌNH KHUYẾN MÃI', resource: 'Tìm kiếm, xem danh sách chương trình khuyến mãi', features: ['Chương trình khuyến mãi › Danh sách chương trình khuyến mãi'] },
  { group: 'CHƯƠNG TRÌNH KHUYẾN MÃI', resource: 'Xem chi tiết chương trình khuyến mãi', features: ['Chương trình khuyến mãi › Xem chi tiết chương trình khuyến mãi'] },
  { group: 'CHƯƠNG TRÌNH KHUYẾN MÃI', resource: 'Xem thống kê chương trình khuyến mãi', features: [] },
  { group: 'CHƯƠNG TRÌNH KHUYẾN MÃI', resource: 'Tạo, chỉnh sửa chương trình khuyến mãi', features: ['Chương trình khuyến mãi › Tạo chương trình khuyến mãi', 'Chương trình khuyến mãi › Chỉnh sửa chương trình khuyến mãi'] },
  { group: 'CHƯƠNG TRÌNH KHUYẾN MÃI', resource: 'Sao chép chương trình khuyến mãi', features: ['Chương trình khuyến mãi › Sao chép chương trình khuyến mãi'] },

  { group: 'MÃ KHUYẾN MÃI', resource: 'Tìm kiếm, xem danh sách mã khuyến mãi', features: ['Mã khuyến mãi › Danh sách mã khuyến mãi'] },
  { group: 'MÃ KHUYẾN MÃI', resource: 'Xem chi tiết mã khuyến mãi', features: ['Mã khuyến mãi › Xem chi tiết mã khuyến mãi'] },
  { group: 'MÃ KHUYẾN MÃI', resource: 'Xem thống kê mã khuyến mãi', features: [] },
  { group: 'MÃ KHUYẾN MÃI', resource: 'Tạo, chỉnh sửa mã khuyến mãi', features: ['Mã khuyến mãi › Tạo mã khuyến mãi', 'Mã khuyến mãi › Chỉnh sửa mã khuyến mãi'] },
  { group: 'MÃ KHUYẾN MÃI', resource: 'Sao chép mã khuyến mãi', features: ['Mã khuyến mãi › Sao chép mã khuyến mãi'] },

  { group: 'QUẢN LÝ ĐA CỬA HÀNG', resource: 'Tìm kiếm, xem danh sách cửa hàng', features: ['Quản lý đa cửa hàng › Trang danh sách cửa hàng', 'Quản lý đa cửa hàng › Xem chi tiết cửa hàng'] },
  { group: 'QUẢN LÝ ĐA CỬA HÀNG', resource: 'Chỉnh sửa nhân viên thuộc cửa hàng', features: ['Quản lý đa cửa hàng › Thêm nhân viên', 'Quản lý đa cửa hàng › Xóa nhân viên khỏi cửa hàng'] },
  { group: 'QUẢN LÝ ĐA CỬA HÀNG', resource: 'Tạo, chỉnh sửa, cập nhật trạng thái cửa hàng', features: ['Quản lý đa cửa hàng › Thêm cửa hàng', 'Quản lý đa cửa hàng › Chỉnh sửa chi tiết cửa hàng'] },

  { group: 'CẤU HÌNH CHUNG', resource: 'Cấu hình phương thức thanh toán', features: ['Cấu hình chung › Phương thức thanh toán'] },
  { group: 'CẤU HÌNH CHUNG', resource: 'Xem danh sách/ chi tiết các phương thức thanh toán', features: ['Cấu hình chung › Phương thức thanh toán'] },
  { group: 'CẤU HÌNH CHUNG', resource: 'Bật/ tắt phương thức thanh toán', features: ['Cấu hình chung › Phương thức thanh toán'] },
  { group: 'CẤU HÌNH CHUNG', resource: 'Xem cấu hình định dạng hiển thị số', features: ['Cấu hình chung › Định dạng hiển thị số'] },
  { group: 'CẤU HÌNH CHUNG', resource: 'Chỉnh sửa cấu hình định dạng hiển thị số', features: ['Cấu hình chung › Định dạng hiển thị số'] },
  { group: 'CẤU HÌNH CHUNG', resource: 'Tự động ký gửi CQT', features: ['Cấu hình chung › Tự động ký CQT'] },
  { group: 'CẤU HÌNH CHUNG', resource: 'Thiết lập thuế', features: ['Cấu hình chung › Thiết lập thuế'] },

  { group: 'ĐƠN HÀNG', resource: 'Tìm kiếm, xem danh sách/ xem chi tiết đơn hàng', features: ['Đơn hàng › Danh sách đơn hàng', 'Đơn hàng › Xem chi tiết đơn hàng'] },
  { group: 'ĐƠN HÀNG', resource: 'In và sao chép đơn hàng', features: ['Đơn hàng › In đơn hàng', 'Đơn hàng › Sao chép đơn hàng'] },
  { group: 'ĐƠN HÀNG', resource: 'Hủy đơn hàng', features: ['Đơn hàng › Hủy đơn hàng'] },
  { group: 'ĐƠN HÀNG', resource: 'Phát hành hoá đơn', features: ['Đơn hàng › Action phát hành hóa đơn'] },
  { group: 'ĐƠN HÀNG', resource: 'Gửi qua AMF TAX', features: ['Đơn hàng › Action Gửi qua AMFTax'] },

  { group: 'TÀI CHÍNH', resource: 'Xem danh sách sổ nợ và thu chi', features: ['Sổ nợ › Danh sách sổ nợ', 'Thu chi › Danh sách phiếu thu chi'] },

  { group: 'DANH BẠ', resource: 'Tìm kiếm, xem danh sách khách hàng/ nhà cung cấp', features: ['Danh bạ › Danh sách khách hàng', 'Danh bạ › Chi tiết khách hàng'] },
  { group: 'DANH BẠ', resource: 'Tạo, chỉnh sửa danh sách khách hàng/ nhà cung cấp', features: ['Danh bạ › Chỉnh sửa khách hàng', 'Danh bạ › Thêm mới khách hàng'] },

  { group: 'THỐNG KÊ & BÁO CÁO', resource: 'Xem báo cáo và thống kê', features: ['Thống kê và báo cáo › Xem báo cáo và thống kê', 'Thống kê và báo cáo › Xem báo cáo - Quản lý dòng tiền', 'Thống kê và báo cáo › Xem báo cáo - Lãi lỗ'] },
  { group: 'THỐNG KÊ & BÁO CÁO', resource: 'Xuất file báo cáo', features: ['Thống kê và báo cáo › Xuất file báo cáo'] },
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export const findPageRow = (group: string, resource: string) =>
  PERMISSION_PAGE.find((r) => norm(r.group) === norm(group) && norm(r.resource) === norm(resource));

/** Matrix nói vai trò có quyền với dòng trên trang Phân quyền không (null = matrix chưa có dòng này) */
export function expectedOnPage(row: PageRow, role: RoleKey): boolean | null {
  if (!row.features.length) return null;
  return row.features.some((ref) => {
    const [group, name] = ref.split(' › ');
    const f = PERMISSIONS.find((g) => g.group === group)?.features.find((x) => x.name === name);
    if (!f) throw new Error(`permission-page.ts: không có chức năng "${ref}" trong PERMISSIONS (permission-matrix.ts)`);
    return isAllowed(f, role);
  });
}
