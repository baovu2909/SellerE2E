/**
 * Dịch lỗi Playwright (tiếng Anh, khó hiểu) sang tiếng Việt dễ hiểu + gợi ý cách sửa, cho tab Lỗi trên trang điều khiển.
 *
 *   explainError(message, snapshot) → { what, todo, screen }
 *     message  : lỗi gốc (đã bỏ mã màu)
 *     snapshot : nội dung error-context.md (ảnh chụp cấu trúc trang lúc lỗi) — dùng để đoán màn hình đang ở đâu
 */

/** getByText('A') → chữ "A"; getByRole('button', { name: 'A' }) → nút "A"; … */
function describeTarget(text) {
  const m =
    text.match(/getByRole\('(\w+)',\s*\{\s*name:\s*'([^']+)'/) ||
    text.match(/getByRole\('(\w+)',\s*\{\s*name:\s*\/([^/]+)\//);
  if (m) {
    const kinds = { button: 'nút', link: 'liên kết', tab: 'tab', textbox: 'ô nhập', checkbox: 'ô tick', menuitem: 'mục menu', heading: 'tiêu đề' };
    return `${kinds[m[1]] ?? m[1]} "${m[2]}"`;
  }
  const t = text.match(/getBy(?:Text|Title|Label|Placeholder)\('([^']+)'/) || text.match(/getBy(?:Text|Title|Label|Placeholder)\(\/([^/]+)\//);
  if (t) return `chữ "${t[1]}"`;
  const l = text.match(/locator\('([^']+)'\)/);
  if (l) return `phần tử \`${l[1]}\``;
  return '';
}

/** Đoán màn hình lúc lỗi từ error-context.md */
function describeScreen(snapshot = '') {
  if (!snapshot) return '';
  if (/Nhập tài khoản của bạn|Đăng Nhập/i.test(snapshot) && /mật khẩu/i.test(snapshot) && !/navigation|app-navbar/i.test(snapshot))
    return 'Màn hình lúc lỗi là TRANG ĐĂNG NHẬP (chưa vào được hệ thống).';
  if (/Xuất hóa đơn điện tử để|dễ dàng cùng AMF Seller/i.test(snapshot)) return 'Màn hình lúc lỗi là TRANG GIỚI THIỆU AMF Seller (trang chủ công khai), chưa vào trong hệ thống.';
  if (/403|không có quyền/i.test(snapshot)) return 'Màn hình lúc lỗi là trang KHÔNG CÓ QUYỀN (403).';
  if (/404|không tìm thấy trang/i.test(snapshot)) return 'Màn hình lúc lỗi là trang KHÔNG TỒN TẠI (404).';
  if (/500|lỗi hệ thống|đã xảy ra lỗi/i.test(snapshot)) return 'Màn hình lúc lỗi báo LỖI HỆ THỐNG.';
  return '';
}

function explainError(message = '', snapshot = '') {
  const msg = message.trim();
  const screen = describeScreen(snapshot);
  const first = msg.replace(/^Error:\s*/, '').split('\n')[0].trim();
  const target = describeTarget(msg);
  const secs = (ms) => Math.round(Number(ms) / 1000);
  let what = '';
  let todo = '';

  const onLogin = /ĐĂNG NHẬP/.test(screen);
  const onLanding = /GIỚI THIỆU/.test(screen);

  if (/ENOENT[\s\S]*(\.playwright-artifacts|traces|test-results)/.test(msg)) {
    what = 'Không ghi được file kết quả (ảnh / trace) vì thư mục kết quả bị xoá giữa chừng.';
    todo = 'Thường do có 2 lần chạy cùng lúc (trang điều khiển + terminal). Chờ lần kia chạy xong rồi chạy lại.';
  } else if (/Target page, context or browser has been closed/.test(msg)) {
    what = 'Trình duyệt bị đóng giữa chừng nên thao tác không làm tiếp được.';
    todo = 'Thường do test trước đó lỗi (trình duyệt được mở lại) hoặc đã bấm Dừng. Xem lỗi của test ngay trước, sửa xong chạy lại.';
  } else if (/net::ERR_|ECONNREFUSED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(msg)) {
    what = 'Không kết nối được tới trang web.';
    todo = 'Kiểm tra mạng / VPN, hoặc server dev/test đang tắt. Mở thử trang web bằng trình duyệt.';
  } else if (/Đăng nhập thất bại|Sai tên đăng nhập hoặc mật khẩu/i.test(msg)) {
    what = first;
    todo = 'Kiểm tra tài khoản đang chọn ở mục Đăng nhập (hoặc SELLER_USERNAME / SELLER_PASSWORD trong env). Tài khoản có thể bị khoá sau nhiều lần sai.';
  } else if (/Test timeout of (\d+)ms exceeded/.test(msg)) {
    const s = secs(msg.match(/Test timeout of (\d+)ms/)[1]);
    const action = /locator\.click/.test(msg) ? 'bấm vào' : /locator\.fill/.test(msg) ? 'nhập vào' : /waitFor/.test(msg) ? 'chờ' : 'tìm';
    what = target
      ? `Quá ${s} giây vẫn không ${action} được ${target} — không thấy nó trên màn hình.`
      : `Test chạy quá ${s} giây nên bị dừng.`;
    todo = onLanding || onLogin
      ? 'Test đang đứng ở ngoài hệ thống (xem dòng "Màn hình") nên không có menu / nút cần tìm. Nếu là trang đăng nhập: bấm Đăng nhập rồi chạy lại; nếu là trang giới thiệu: test mở sai địa chỉ.'
      : 'Mở ảnh "Màn hình cuối" xem nút / chữ đó có trên màn hình không: nếu có mà tên khác → sửa tên trong test; nếu trang tải chậm → chạy lại; nếu mất hẳn → có thể là lỗi giao diện.';
  } else if (/locator\.(\w+): Timeout (\d+)ms exceeded/.test(msg)) {
    const [, act, ms] = msg.match(/locator\.(\w+): Timeout (\d+)ms exceeded/);
    const verbs = { click: 'bấm vào', fill: 'nhập vào', check: 'tick', hover: 'rê chuột lên', waitFor: 'chờ thấy' };
    what = `Sau ${secs(ms)} giây vẫn không ${verbs[act] ?? act} được ${target || 'phần tử cần thao tác'}.`;
    todo = /intercepts pointer events/.test(msg)
      ? 'Có thứ khác (popup / khung che) đang che mất nó. Xem ảnh Màn hình cuối để biết popup nào.'
      : 'Xem ảnh Màn hình cuối: phần tử có hiện không, có bị che / bị khoá không.';
  } else if (/toHaveURL/.test(msg)) {
    what = first && !/^expect\(/.test(first) ? first : 'Trang bị chuyển sang địa chỉ không mong muốn.';
    const url = msg.match(/Received string:\s*"([^"]+)"/);
    if (url) what += ` (đang ở: ${url[1].replace(/^https?:\/\/[^/]+/, '')})`;
    todo = /errors\/403/.test(msg) ? 'Bị chặn quyền — kiểm tra quyền của vai trò trong permission-matrix.ts hoặc phân quyền trên hệ thống.' : /auth/.test(msg) ? 'Bị đá về trang đăng nhập — bấm Đăng nhập rồi chạy lại.' : 'So sánh với ảnh Màn hình cuối.';
  } else if (/toBeVisible|toHaveCount|toContainText|toHaveText|toBeDisabled|toBeEnabled|toBe\(|toEqual|toBeLessThanOrEqual|toBeNull|not\.toBeNull|toBeTruthy/.test(msg)) {
    // lỗi so sánh: dòng đầu thường là lời giải thích tiếng Việt viết sẵn trong test
    what = first && !/^expect\(/.test(first) ? first : `Kết quả trên màn hình không đúng như mong đợi${target ? ` (${target})` : ''}.`;
    todo = 'Xem ảnh Màn hình cuối / các ảnh từng bước để đối chiếu.';
  } else {
    what = first || 'Lỗi không rõ.';
    todo = 'Xem ảnh Màn hình cuối và mục Chi tiết kỹ thuật bên dưới.';
  }
  return { what, todo, screen };
}

module.exports = { explainError };
