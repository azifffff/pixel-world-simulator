# Aetheria 3D

Bản đồ hiển thị địa hình Aetheria 2.1 bằng Three.js ở chế độ 3D và PixiJS ở chế độ 2D isometric. Thế giới phẳng hữu hạn có diện tích **1.020.200.000 km²**, cạnh khoảng **31.940,57 km**. Bố cục lục địa, thủy hệ và seed mặc định `aetheria` dùng chung bộ sinh của bản 2.1.

## Mở bản đồ online

[Chơi Aetheria 3D trên GitHub Pages](https://azifffff.github.io/pixel-world-simulator/). Trang mở bằng trình duyệt có WebGL 2 và đưa camera đến vách đá của cao nguyên phía đông. Mỗi cập nhật trên `main` chạy kiểm thử trước khi workflow **Deploy map to GitHub Pages** phát hành.

## Chạy để phát triển

Dùng Node.js 24 và npm 11.

```sh
npm ci
npm run dev
```

Mở <http://localhost:5173>. Trong Codespaces, mở cổng 5173 từ tab **Ports**. Để thử bản build ở đúng đường dẫn của dự án:

```sh
npm run build -- --base=/pixel-world-simulator/
npm exec vite preview -- --base=/pixel-world-simulator/ --host 0.0.0.0
```

Mở <http://localhost:4173/pixel-world-simulator/>.

## Khám phá địa hình

- Chọn **2D** hoặc **3D** trên thanh điều khiển của bản đồ. Khi chuyển, bản đồ giữ điểm địa hình ở tâm, tỷ lệ quan sát trong giới hạn của mỗi camera và các lớp đang bật. Góc nhìn trước tiếp tục hiển thị trong lúc góc nhìn mới chuẩn bị.
- Dùng **Xoay** và **Nghiêng** để quan sát địa hình 3D từ các hướng khác nhau. Nút **Vách đá 3D** đưa camera trở lại vách đá. Trạng thái ngay dưới các nút hiển thị khi góc nhìn đã sẵn sàng.
- Kéo nút chuột trái để di chuyển, cuộn để zoom quanh con trỏ. Ở chế độ 3D, giữ nút chuột phải hoặc `Shift` khi kéo để xoay và đổi góc nghiêng. Trên màn hình cảm ứng, kéo một ngón để di chuyển và chụm hai ngón để thu phóng. Di chuyển hai ngón cùng lúc ở chế độ 3D điều chỉnh góc nhìn.
- Các nút thu phóng dùng tâm bản đồ. Chọn **Đến siêu lục địa** để căn khung lục địa chính, hoặc dùng nút ngôi nhà để về toàn cảnh. Khi bản đồ có tiêu điểm, dùng mũi tên để di chuyển, `Shift` và mũi tên để xoay ở chế độ 3D, `+` và `−` để thu phóng, `Home` để về toàn cảnh.
- **Địa hình nổi** hiển thị cao độ và đổ bóng. **Phân loại địa hình** làm rõ màu nhóm địa hình trên cùng lưới cao độ. Công tắc lớp cho phép điều khiển màu, đổ bóng, nước nội địa, lưới hex, biên chunk và đường đồng mức.
- Bảng thông tin tại con trỏ hiển thị vị trí theo mét, hex axial, chunk, cao độ, loại địa hình nền, bề mặt, độ dốc, độ gồ ghề, nước và LOD. Trên màn hình hẹp, mở bảng tùy chọn từ thanh công cụ.
- Bản đồ chọn bước lấy mẫu theo zoom. Lưới hex mặc định ẩn. Biên chunk và đường đồng mức xuất hiện khi phóng đủ gần để đọc được. Hex cách nhau 20 km giữa hai cạnh đối diện, với diện tích mỗi ô khoảng 346,41 km². Lưới logic 5 × 5 m và chunk 640 × 640 m dùng chung tọa độ thế giới.

Ảnh Chromium của nhánh thử nghiệm gồm [toàn cảnh](docs/aetheria-3d/world.jpg), [siêu lục địa](docs/aetheria-3d/continent.jpg), [vách đá ở LOD 4](docs/aetheria-3d/near.jpg) và [góc camera đã xoay](docs/aetheria-3d/rotated.jpg).

## Dữ liệu và cấu hình

| Tệp | Trách nhiệm |
| --- | --- |
| `src/terrain/aether-config.ts` | Cấu hình bố cục với ID ổn định, tọa độ chuẩn hóa và tham số cấu trúc địa hình. |
| `src/terrain/aether-layout.ts` | Đường bờ, địa hình theo trục núi, cao nguyên, đồng bằng, bồn địa và các trường môi trường. |
| `src/terrain/aether-hydrology.ts` | Lưu vực, mạng thoát nước và hồ trên lưới khu vực. |
| `src/terrain/aether-classification.ts` | Phân loại địa mạo, lớp phủ, nước và bảng màu. |
| `src/terrain/generator.ts` | Kết hợp cao độ, hình thái và nước ở tọa độ toàn cục. |
| `src/terrain/metadata.ts`, `src/terrain/patches.ts` | Seed, phiên bản và bản vá lưu độc lập với dữ liệu sinh. |
| `src/world/` | Tọa độ lục giác, camera trực giao, chuyển hệ trục và tải mảnh theo LOD. |
| `src/render3d/`, `src/ui.ts` | Mesh Three.js, nước, rừng, lớp phủ và bảng thông tin. |
| `src/render/map2d.ts` | Bộ điều hợp cho bản đồ isometric PixiJS với cùng dữ liệu chunk. |

Seed mặc định là `aetheria`. Sửa `DEFAULT_AETHER_CONFIG` để thay đường bờ, vị trí và hình dạng các cấu trúc lớn. Tọa độ chuẩn hóa tăng về phía đông và hướng xuống về phía nam. API cấu hình thế giới chấp nhận một `layout` riêng. Điều chỉnh `seaLevel`, `reliefMultiplier` và `riverWidthMeters` tại `src/terrain/metadata.ts`. Cao độ trả về theo mét so với mực biển.

Bản đồ dùng camera trực giao. Góc toàn cảnh gần góc isometric của bản 2.1, còn góc mở đầu nhìn xiên dọc theo vách đá. Trong Three.js, trục X hướng đông, trục Z hướng nam và trục Y bằng 0,77 lần cao độ để giữ tỷ lệ trực quan. Gốc render dịch theo camera. Cao độ logic, độ dốc thực, phạm vi bản vá và tọa độ kiểm tra vẫn tính theo mét. Bảng thông tin lấy vị trí bằng tia giao với bề mặt địa hình đang vẽ.

Sườn dốc và vách đá dùng chung lưới tam giác cao độ. Ở góc gần, lượng ánh sáng phụ thuộc vào hướng từng mặt tam giác. Các mặt đủ dốc và đủ chênh cao có vật liệu đá. Rừng dùng lưới phân bố 19 m, tán rộng 6–8 m và chiều cao khoảng 16–23 m. Gốc cây lấy cao độ từ tam giác mặt đất. Thân và tán dùng hình học 3D gộp theo vùng.

Bộ tải lấy mẫu theo vùng quan sát 3D và giữ các mảnh gần trong cache LRU. Bước lấy mẫu biến đổi từ hàng chục km ở LOD 0 đến 5–20 m ở LOD 4 tùy ngân sách hiển thị. Cao độ dữ liệu tại một tọa độ là như nhau ở mọi LOD, còn cao độ nội suy trên mesh phụ thuộc bước lấy mẫu. Khi chuyển mức chi tiết, các mảnh tiếp giáp dùng cùng bước lấy mẫu trước khi bề mặt mới thay thế bề mặt đang hiển thị.

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

Bản vá dùng khóa lưu trữ theo seed, phiên bản, kích thước và cấu hình. Nhánh 3D dùng cùng phiên bản bộ sinh v3 và khóa lưu với Aetheria 2.1. Khi mở bản lưu demo v1 hoặc Aetheria 2.0, ứng dụng lưu riêng metadata gốc và giữ bản vá dưới khóa gốc. Có thể phục hồi bản lưu trong phiên bản bộ sinh tương ứng.

## Kiểm thử

```sh
npm test
npm run typecheck
npm run build
```

Các kiểm thử dùng Node.js thuần để kiểm tra hình thái địa hình, kích thước lục địa và bờ biển, thoát nước, hình học hex và chunk, khả năng tái lập qua seed và LOD, thêm và khôi phục bản vá, cùng giới hạn cache khi di chuyển camera.

Kiểm tra Chromium dùng WebGL 2 với SwiftShader. Lượt thử đổi camera ở góc gần đã hiển thị LOD 4 với bước lấy mẫu 10 m ở góc mặc định và 5 m khi xoay, trong giới hạn 120 mảnh hiển thị. Cache dữ liệu tối đa 256 mảnh, còn cache tài nguyên Three.js giới hạn ở 240 nhóm mảnh.

## Phạm vi mô phỏng

- Lục địa xa có bờ biển và độ cao đại cương.
- Thủy hệ khu vực dùng lưới hữu hạn và không mô phỏng xói mòn hay biến động mực nước theo thời gian.
- Vách đá là bề mặt cao độ dốc trên lưới, phù hợp cho các sườn và mép cao nguyên. Hình học hang hoặc mái đá nhô cần biểu diễn khác.
- Bản 2D nạp PixiJS ở lần chuyển đầu tiên. Khi đổi vùng ở độ phóng to cao, thời gian dựng mesh phụ thuộc trình duyệt và GPU.
- Bản vá biên tập qua API, lưu trên origin hiện tại của trình duyệt. Thay đổi cao độ bằng bản vá tác động lên bề mặt địa phương. Mạng lưu vực cấp khu vực được tính từ bố cục nền.
