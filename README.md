# Aetheria 2.0

Bản đồ địa hình tự nhiên pixel isometric, sinh theo seed và chạy trong trình duyệt bằng TypeScript, Vite và PixiJS. Thế giới phẳng hữu hạn có diện tích 1.530.000.000 km², cạnh xấp xỉ 39.115 km. Một siêu lục địa bất đối xứng chứa các hệ núi, cao nguyên, đồng bằng và bồn địa. Quần đảo kéo về phía đông nam với một khoảng đại dương ngăn cách lục địa xa.

## Mở bản đồ

Bản triển khai GitHub Pages mở trực tiếp trong trình duyệt có WebGL. [Mở Aetheria](https://azifffff.github.io/pixel-world-simulator/)

Để phát triển cục bộ, dùng Node.js 24 và npm 11.

```sh
npm ci
npm run dev
```

Mở <http://localhost:5173>. `npm run build` tạo bản tĩnh trong `dist/`. Workflow `.github/workflows/deploy-pages.yml` build theo đường dẫn `/pixel-world-simulator/` khi nhánh `main` thay đổi hoặc khi được chạy thủ công.

## Khám phá địa hình

- Kéo để di chuyển, cuộn để zoom quanh con trỏ. Các nút thu phóng dùng tâm bản đồ. Chọn **Đến siêu lục địa** để căn khung lục địa chính, hoặc dùng nút ngôi nhà để về toàn cảnh. Bàn phím hỗ trợ các phím mũi tên, `+`, `−` và `Home` khi bản đồ có tiêu điểm.
- **Địa hình nổi** hiển thị cao độ và đổ bóng. **Phân loại địa hình** làm rõ màu nhóm địa hình trên cùng lưới cao độ. Công tắc lớp cho phép điều khiển màu, đổ bóng, nước nội địa, lưới hex, biên chunk và đường đồng mức.
- Bảng thông tin tại con trỏ hiển thị vị trí theo mét, hex axial, chunk, cao độ, loại địa hình nền, bề mặt, độ dốc, độ gồ ghề, nước và LOD. Trên màn hình hẹp, mở bảng tùy chọn từ thanh công cụ.
- Bản đồ chọn bước lấy mẫu theo zoom. Biên chunk và đường đồng mức xuất hiện khi phóng đủ gần để đọc được. Hex cách nhau 20 km giữa hai cạnh đối diện. Chunk địa phương có kích thước 640 × 640 m.

## Dữ liệu và cấu hình

| Tệp | Trách nhiệm |
| --- | --- |
| `src/terrain/aether-config.ts` | Cấu hình bố cục với ID ổn định, tọa độ chuẩn hóa và tham số cấu trúc địa hình. |
| `src/terrain/aether-layout.ts` | Đường bờ, địa hình theo trục núi, cao nguyên, đồng bằng, bồn địa và các trường môi trường. |
| `src/terrain/aether-hydrology.ts` | Lưu vực, mạng thoát nước và hồ trên lưới khu vực. |
| `src/terrain/aether-classification.ts` | Phân loại địa mạo, lớp phủ, nước và bảng màu. |
| `src/terrain/generator.ts` | Kết hợp cao độ, hình thái và nước ở tọa độ toàn cục. |
| `src/terrain/metadata.ts`, `src/terrain/patches.ts` | Seed, phiên bản và bản vá lưu độc lập với dữ liệu sinh. |
| `src/world/` | Tọa độ lục giác, camera, chọn điểm trên mesh và tải mảnh theo LOD. |
| `src/render/`, `src/ui.ts` | Mesh PixiJS, chế độ hiển thị, lớp phủ và bảng thông tin. |

Seed mặc định là `aetheria`. Sửa `DEFAULT_AETHER_CONFIG` để thay đường bờ, vị trí và hình dạng các cấu trúc lớn. Tọa độ chuẩn hóa tăng về phía đông và hướng xuống về phía nam. API cấu hình thế giới chấp nhận một `layout` riêng. Điều chỉnh `seaLevel`, `reliefMultiplier` và `riverWidthMeters` tại `src/terrain/metadata.ts`. Cao độ trả về theo mét so với mực biển.

Bộ tải lấy mẫu trong vùng quan sát và giữ các mảnh gần trong cache LRU. Bước lấy mẫu biến đổi từ hàng chục km ở LOD 0 đến 5–20 m ở LOD 4 tùy ngân sách hiển thị. Cao độ tại một tọa độ là như nhau ở mọi LOD. Khi lưới lấy mẫu thưa, các tuyến sông lớn được vẽ liên tục từ mạng thủy hệ trên cùng bề mặt. Mesh dùng tọa độ tương đối với camera để duy trì độ chính xác khi zoom sát ở xa gốc tọa độ.

## Lưu Terrain Patch

`TerrainData` nhận dữ liệu khảo sát qua `setAuthoredTerrain` và bản vá qua `setPatch`. Giá trị sinh tự động được ghi đè theo từng trường bởi dữ liệu khảo sát, sau đó bởi bản vá mới nhất có khai báo trường đó. Bản vá có tọa độ theo mét, cao độ tuyệt đối, vùng chuyển tiếp tùy chọn `blendMeters` và thuộc tính bề mặt hoặc biome.

```ts
import { createWorldMetadata, TerrainData } from './src/terrain/index.ts';

const metadata = createWorldMetadata('aetheria');
const terrain = new TerrainData(metadata, localStorage);
terrain.setPatch({
  id: 'raise-ridge',
  minX: 10_400_000,
  minY: 19_440_000,
  maxX: 10_420_000,
  maxY: 19_460_000,
  elevation: 2_400,
  blendMeters: 4_000,
});

console.log(new TerrainData(metadata, localStorage).sample(10_410_000, 19_450_000));
```

Bản vá dùng khóa lưu trữ theo seed, phiên bản, kích thước và cấu hình. Đổi seed hoặc bố cục giữ lại dữ liệu của cấu hình cũ. Khi lần đầu mở bản lưu demo v1, ứng dụng cảnh báo khác phiên bản và giữ nguồn v1 trong bộ nhớ trình duyệt để dữ liệu cũ có thể được lấy lại.

## Kiểm thử

```sh
npm test
npm run typecheck
npm run build
```

Các kiểm thử dùng Node.js thuần để kiểm tra hình thái địa hình, kích thước lục địa và bờ biển, thoát nước, hình học hex và chunk, khả năng tái lập qua seed và LOD, thêm và khôi phục bản vá, cùng giới hạn cache khi di chuyển camera.

## Phạm vi mô phỏng

- Lục địa xa có bờ biển và độ cao đại cương.
- Thủy hệ khu vực dùng lưới hữu hạn và không mô phỏng xói mòn hay biến động mực nước theo thời gian.
- Bản vá biên tập qua API, lưu trên origin hiện tại của trình duyệt. Thay đổi cao độ bằng bản vá tác động lên bề mặt địa phương. Mạng lưu vực cấp khu vực được tính từ bố cục nền.
