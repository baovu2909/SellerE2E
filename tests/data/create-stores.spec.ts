import { test } from '../shared-page';
import { CreateStorePage } from '../../pages/create-store.page';

const COUNT = Number(process.env.STORE_COUNT ?? 20);
const START = Number(process.env.STORE_START ?? 1);

const STREETS = [
  'Nguyễn Trãi', 'Lê Lợi', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Lý Thường Kiệt',
  'Nguyễn Huệ', 'Phan Chu Trinh', 'Điện Biên Phủ', 'Cách Mạng Tháng 8', 'Võ Văn Tần',
];

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomLocationCode = () => String(randomInt(0, 99999)).padStart(5, '0');
const randomAddress = () => `${randomInt(1, 999)} ${STREETS[randomInt(0, STREETS.length - 1)]}`;

for (let i = START; i < START + COUNT; i++) {
  test(`tạo cửa hàng Emolite Shop ${i}`, async ({ page }) => {
    const storePage = new CreateStorePage(page);
    await storePage.goto();

    const info = {
      storeName: `Cửa hàng máy tính ${i}`,
      sellLocationCode: randomLocationCode(),
      address: randomAddress(),
    };
    const { province, ward } = await storePage.create(info);
    console.log(`✔ ${info.storeName} | mã ĐĐKD ${info.sellLocationCode} | ${info.address}, ${ward}, ${province}`);
  });
}
