# Aetheria 2.1

Bản đồ địa hình tự nhiên pixel isometric, sinh theo seed và chạy trong trình duyệt bằng TypeScript, Vite và PixiJS. Thế giới phẳng hữu hạn có diện tích **1.020.200.000 km²**, cạnh khoảng **31.940,57 km**. Lục địa chính có vùng lõi rộng, ít bán đảo hẹp hơn và tiếp giáp một dải quần đảo ở phía nam. Hai khối đất chính cách nhau bằng đại dương.

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
- Bản đồ chọn bước lấy mẫu theo zoom. Lưới hex mặc định ẩn. Biên chunk và đường đồng mức xuất hiện khi phóng đủ gần để đọc được. Hex cách nhau 20 km giữa hai cạnh đối diện, với diện tích mỗi ô khoảng 346,41 km². Lưới logic 5 × 5 m và chunk 640 × 640 m dùng chung tọa độ thế giới.

[Ảnh đối chiếu Aetheria 2.0 và 2.1](docs/aetheria-2.1/comparison.png) gồm toàn cảnh, khung lục địa và hai cảnh chi tiết ở cùng tỷ lệ quan sát.

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

Bố cục xác định hình thể chính của lục địa trước khi bổ sung biến thiên đường bờ theo seed. Dãy núi, cao nguyên và lưu vực được bố trí trong hình thể mới. Phép chiếu isometric tăng hệ số cao độ trên màn hình từ 0,45 lên 0,67. Cao độ logic, độ dốc thực và tọa độ kiểm tra vẫn tính từ dữ liệu theo mét.

Sườn dốc và vách đá dùng chung lưới tam giác cao độ. Các mặt đủ dốc và đủ chênh cao có vật liệu đá và đổ bóng theo hướng. Bố cục mặc định có một dải vách ở cao nguyên phía đông. Rừng dùng lưới phân bố 19 m, tán rộng 6–8 m và chiều cao khoảng 16–23 m. Gốc cây lấy cao độ từ tam giác mặt đất, còn bộ đệm chiều sâu xác định mặt địa hình hay tán cây ở phía trước theo góc nhìn.

Bộ tải lấy mẫu trong vùng quan sát và giữ các mảnh gần trong cache LRU. Bước lấy mẫu biến đổi từ hàng chục km ở LOD 0 đến 5–20 m ở LOD 4 tùy ngân sách hiển thị. Cao độ tại một tọa độ là như nhau ở mọi LOD. Khi lưới lấy mẫu thưa, các tuyến sông lớn được vẽ liên tục từ mạng thủy hệ trên cùng bề mặt. Khi nhảy qua nhiều cấp zoom, bộ tải có thể chuẩn bị một cấp trung gian trước khi thay toàn bộ bề mặt đang vẽ. Mesh dùng tọa độ tương đối với camera để duy trì độ chính xác ở xa gốc tọa độ.

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

Bản vá dùng khóa lưu trữ theo seed, phiên bản, kích thước và cấu hình. Khi mở bản lưu demo v1 hoặc Aetheria 2.0, ứng dụng lưu trữ riêng metadata gốc và thông báo đã mở một thế giới 2.1. Bản vá cũ vẫn nằm dưới khóa gốc. Có thể phục hồi bản lưu trong phiên bản bộ sinh tương ứng. Tọa độ bản vá 2.1 được lưu theo kích thước và bố cục mới.

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
- Vách đá là bề mặt cao độ dốc trên lưới, phù hợp cho các sườn và mép cao nguyên. Hình học hang hoặc mái đá nhô cần biểu diễn khác.
- Bản vá biên tập qua API, lưu trên origin hiện tại của trình duyệt. Thay đổi cao độ bằng bản vá tác động lên bề mặt địa phương. Mạng lưu vực cấp khu vực được tính từ bố cục nền.
