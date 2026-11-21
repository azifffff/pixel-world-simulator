# Pixel World Simulator

Bản đồ địa hình pixel isometric sinh theo seed, chạy trong trình duyệt bằng TypeScript, Vite và PixiJS 8. Thế giới là một mặt phẳng hữu hạn, cạnh khoảng 39.115 km và diện tích 1.530.000.000 km². Lưới địa lý có ô hex rộng 20 km giữa hai cạnh đối diện, tương đương khoảng 4,42 triệu ô theo diện tích.

## Cài đặt và chạy

Dùng Node.js 24 và npm 11. Phiên bản Node đã kiểm tra nằm trong `.nvmrc`.

```sh
npm ci
npm run dev
```

Mở <http://localhost:5173>. Trình duyệt cần hỗ trợ tăng tốc đồ họa WebGL. Có thể dùng `npm run build` để xuất bản tĩnh vào `dist/` và `npx vite preview` để chạy thử bản build.

Kéo trên bản đồ để di chuyển, cuộn để zoom quanh vị trí con trỏ. Các nút `+`, `−` thu phóng quanh tâm và nút ngôi nhà đưa camera về toàn cảnh. Khi khu vực bản đồ có tiêu điểm, có thể dùng phím mũi tên, `+`, `−` và `Home`. Bảng bên trái có ô đổi seed, chú giải và công tắc đường biên hex. Trên màn hình hẹp, mở bảng bằng nút **Tùy chọn bản đồ**. Chỉ báo trên bản đồ hiển thị tọa độ theo mét, ô axial, cao độ, cấp LOD, số mảnh đang vẽ và số chunk chi tiết tương ứng. Khi nhìn toàn cảnh hoặc khi lưới quá dày, lớp phủ hex chỉ đánh dấu ô đang quan sát.

## Cấu trúc mã nguồn

| Tệp hoặc thư mục | Trách nhiệm |
| --- | --- |
| `src/main.ts` | Khởi tạo ứng dụng PixiJS, kết nối giao diện, camera, dữ liệu và render. |
| `src/world/coordinates.ts` | Tọa độ toàn cục theo mét, chuyển đổi axial, láng giềng hex, cắt hex tại biên vuông, định danh chunk và ô logic 5 m. |
| `src/world/camera.ts` | Camera tương đối với tâm, pan, zoom mượt quanh con trỏ và kiểm tra vùng nhìn. |
| `src/world/surface.ts` | Nội suy cao độ trên lưới đang vẽ và tìm vị trí trên mặt địa hình từ con trỏ. |
| `src/world/streaming.ts` | Chọn độ phân giải theo zoom, lấy mẫu theo ngân sách mỗi frame, giới hạn cache và chỉ giữ các mảnh giáp vùng nhìn. |
| `src/world/world.ts` | Mở thế giới theo cấu hình, kết nối dữ liệu địa hình với bộ tải mảnh. |
| `src/terrain/` | Cấu hình thế giới, sinh địa hình xác định, kết hợp lớp gốc với dữ liệu thủ công và patch. |
| `src/render/` | Mesh địa hình, bảng màu pixel, cây trang trí ở mức gần, lớp phủ hex và vòng đời tài nguyên render. |
| `src/ui.ts`, `src/style.css`, `index.html` | Giao diện và điều khiển bản đồ. |
| `tests/` | Kiểm thử logic bằng trình chạy `node:test`. |

Bố cục hex phục vụ truy vấn địa lý. Chunk 640 × 640 m dùng chung hệ tọa độ với hex và có thể cắt qua đường biên hex. Các tọa độ dùng số JavaScript 64-bit. Mesh sử dụng tọa độ tương đối với từng mảnh, rồi đặt mảnh tương đối với camera trước khi chuyển cho GPU. Các đỉnh trên mép chung lấy cùng mẫu cao độ tại tọa độ toàn cục.

## Cấu hình và LOD

Seed mặc định là `verdant-reach`. Seed đang chọn, phiên bản bộ sinh, cạnh thế giới và tham số địa hình được lưu trong `localStorage` của origin hiện tại. Có thể điều chỉnh mặc định `seaLevel`, `reliefMultiplier` và `riverWidthMeters` trong `src/terrain/metadata.ts`. Tọa độ vẫn tính bằng mét khi đổi kích thước thế giới. Tăng phiên bản bộ sinh khi thay đổi quy tắc sinh địa hình để nhận diện đúng dữ liệu từng phiên bản.

| LOD | Bước lấy mẫu điển hình | Mục đích |
| --- | --- | --- |
| 0 | Từ 40.960 m | Toàn cảnh, dùng dữ liệu tổng hợp. |
| 1 | 5.120–20.480 m | Vùng địa lý lớn. |
| 2 | 320–2.560 m | Địa hình quanh một hoặc nhiều ô hex. |
| 3 | 40–160 m | Địa hình địa phương và chi tiết sông, rừng. |
| 4 | 5–20 m | Địa hình gần và cây pixel. |

Bước lấy mẫu thay đổi theo lũy thừa hai và được tự động chọn để giữ số mảnh trong giới hạn, kể cả ở LOD 4. Mỗi mảnh chứa lưới tối đa 32 × 32 mặt địa hình. `STREAM_SETTINGS` trong `src/world/streaming.ts` đặt mục tiêu tạo tối đa 4 mảnh trong khoảng 6 ms mỗi khung, với tối đa 120 mảnh hiển thị và 256 mảnh dữ liệu trong cache LRU. Renderer có thể chuẩn bị mesh cho độ phân giải đích trước khi chuyển lớp hiển thị. Ở LOD 3 và 4, số chunk hiển thị là số ô vật lý 640 m được các mảnh đang vẽ bao phủ. Mức tổng hợp hiển thị số mảnh thay cho số chunk chi tiết.

## Thử lưu Terrain Patch

`TerrainData` cung cấp `setAuthoredTerrain`, `setPatch`, `removeAuthoredTerrain`, `removePatch`, `sample` và `elevationAt`. Lớp nguồn được sinh theo cấu hình. Sau đó mỗi trường nhận giá trị từ dữ liệu thủ công, rồi từ patch mới nhất có khai báo trường đó. Patch gồm `id`, hình chữ nhật theo mét và một hoặc cả hai trường `elevation`, `biome`.

```ts
import { createWorldMetadata, TerrainData } from './src/terrain/index.ts';

const metadata = createWorldMetadata('patch-demo');
const terrain = new TerrainData(metadata, localStorage);
terrain.setPatch({
  id: 'test-hill',
  minX: 1_200,
  minY: 1_200,
  maxX: 1_400,
  maxY: 1_400,
  elevation: 480,
  biome: 'hills',
});

const reopened = new TerrainData(metadata, localStorage);
console.log(reopened.sample(1_300, 1_300));
```

Lưu trữ dùng khóa riêng theo seed, phiên bản, kích thước và tham số sinh. Các patch đã lưu khôi phục khi mở lại cùng cấu hình trong cùng origin. Nền địa hình được tái sinh từ metadata. Thay đổi cấu hình tạo bộ dữ liệu chỉnh sửa riêng.

## Kiểm thử

```sh
npm test
npm run typecheck
npm run build
```

`npm test` đạt 19 kiểm thử. Kiểm tra kiểu và bản build sản xuất đều thành công. Bộ kiểm thử xác nhận quy mô logic, lưới khớp tới biên vuông, chuyển đổi và chọn tọa độ ở góc xa, kéo và zoom quanh con trỏ, đủ năm cấp LOD, chỉ tạo dữ liệu theo vùng quan sát, địa hình xác định qua thứ tự tải khác nhau, mạch sông qua nhiều chunk và hex, lưu và tải lại patch, tái sử dụng dữ liệu khi quay lại khu vực cũ và giới hạn cache qua nhiều vùng.

Chromium ở khung 390 × 844 đã hiển thị địa hình và xác nhận kéo cảm ứng, thu phóng bằng nút, thay seed và khôi phục seed khi tải lại. Phép đo WebGL qua SwiftShader ở 80 vị trí, luân phiên LOD 3 và 4 với vùng nhìn 240 × 192, ghi nhận tối đa 4 mesh và 240 mảnh dữ liệu. Renderer giải phóng 240 mesh trong lượt chạy và còn 0 mesh khi vùng xem được dọn.

Trong Chromium ở khung 1440 × 900, toàn cảnh mặc định hiển thị 16 mảnh tổng hợp. Kéo bản đồ, bật tắt đường biên hex và cuộn qua cả năm LOD đều hoạt động. Quan sát gần ở góc xa xác định đúng vị trí (39.115.147 m, 39.115.147 m). Một bản vá lưu qua API nội bộ đã đổi cao độ hiển thị từ 259 m thành 2.400 m sau khi tải lại trang.

## Giới hạn của phiên bản đầu

- Sông dùng mạng tuyến sinh bằng hàm tọa độ, có nhánh và hành lang liên tục. Mô hình lưu vực và dòng chảy theo độ dốc là phần có thể bổ sung sau.
- Việc tạo mảnh chạy từng đợt trên luồng chính. Khung xem có thể tạm dùng dữ liệu thưa hơn khi đổi LOD hoặc nhảy xa. Chuyển việc lấy mẫu sang worker và cải thiện chuyển cảnh ở thiết bị chậm là các hướng tối ưu tiếp theo.
- API chỉnh địa hình xử lý vùng chữ nhật và lưu cục bộ theo trình duyệt. Biên tập trực quan, di trú patch giữa phiên bản thuật toán và chia sẻ chỉnh sửa cần được phát triển thêm.
