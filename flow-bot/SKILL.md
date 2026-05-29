---
name: flow-bot
description: >
  Tự động hoá Google Labs Flow (labs.google/fx/vi/tools/flow): tạo project,
  chọn mode/tỉ lệ/số lượng, nhập prompt, upload ảnh tham chiếu, lưu kết quả.
  Trigger: "flow", "tạo flow", "labs flow", "google flow", "tạo ảnh flow".

---

# Google Labs Flow Bot — Skill

## Điều kiện tiên quyết
- Chrome đang chạy với `--remote-debugging-port=9222`
- Đã đăng nhập tài khoản Google trên tab `labs.google/fx/vi/tools/flow`

## Đường dẫn script

| Tác vụ | Script |
|---|---|
| Tạo project mới | `node C:\Users\ADMIN\openClawVeo3\flowMode\create-project.js` |
| Mở tab / đóng tab cũ | `node C:\Users\ADMIN\openClawVeo3\flowMode\open-tab.js [url]` |
| Chọn mode/ratio/qty | `node C:\Users\ADMIN\openClawVeo3\flowMode\select-options.js [mode] [ratio] [qty] [model]` |
| Sắp xếp tài sản | `node C:\Users\ADMIN\openClawVeo3\flowMode\sort-assets.js [recent\|oldest\|name]` |
| Click tài sản | `node C:\Users\ADMIN\openClawVeo3\flowMode\click-asset.js [index]` |
| Nhập prompt & submit | `node C:\Users\ADMIN\openClawVeo3\flowMode\input-prompt.js "[prompt]" [pastePercent]` |
| Upload ảnh | `node C:\Users\ADMIN\openClawVeo3\flowMode\upload-image.js "[path]"` |
| Lưu ảnh kết quả | `node C:\Users\ADMIN\openClawVeo3\flowMode\save-images.js "[folder]" "[prefix]" [mode] [ratio]` |

## Tham số

| Tham số | Mô tả | Giá trị hợp lệ |
|---|---|---|
| MODE | Loại nội dung | `image`, `video` |
| RATIO | Tỉ lệ khung hình | `16:9`, `4:3`, `1:1`, `3:4`, `9:16` |
| QTY | Số lượng tạo | `1`, `2`, `3`, `4` |
| MODEL | Tên model (tùy chọn) | `Nano Banana Pro`, `Nano Banana` |
| PROMPT | Mô tả nội dung | Chuỗi văn bản |
| IMAGE_PATH | Đường dẫn ảnh tham chiếu | Đường dẫn tuyệt đối Windows |
| OUTPUT_FOLDER | Thư mục lưu ảnh | Đường dẫn tuyệt đối Windows |
| PREFIX | Tiền tố tên file | vd: `hat_outdoor` |

## Quy trình chuẩn — TỪNG BƯỚC MỘT

### Bước 1: Tạo project mới (nếu cần)
```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\flowMode\create-project.js"
```
Chờ JSON `{"success": true}` trước khi tiếp tục.

### Bước 2: Chọn cài đặt
```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\flowMode\select-options.js [MODE] [RATIO] [QTY]"
```
VD: `select-options.js image 1:1 2`

### Bước 3: Upload ảnh tham chiếu (nếu có)
```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\flowMode\upload-image.js \"[IMAGE_PATH]\""
```
Bỏ qua bước này nếu không có ảnh.

### Bước 4: Nhập prompt & submit
```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\flowMode\input-prompt.js \"[PROMPT]\" 60"
```
Chờ log "ĐÃ GỬI PROMPT" mới qua bước sau.

### Bước 5: Lưu ảnh kết quả
```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\flowMode\save-images.js \"[OUTPUT_FOLDER]\" \"[PREFIX]\" [MODE] [RATIO]"
```
Ảnh được lưu vào `OUTPUT_FOLDER/YYYYMMDD_HHmmss_PREFIX_MODE_RATIO/img_001.jpg`.

## Quy tắc bắt buộc

1. **LUÔN dùng exec với `elevated:true` và `pty:true`**
2. **KHÔNG chạy gộp nhiều lệnh cùng lúc**
3. **CHỜ XONG MỚI CHẠY TIẾP** — đọc output JSON trả về sau mỗi bước

## Ví dụ sử dụng

**"Tạo ảnh hat tỉ lệ 1:1, x2"**
→ MODE=image, RATIO=1:1, QTY=2

**"Làm video sunglasses 16:9, dùng ảnh C:\Desktop\ref.jpg"**
→ MODE=video, RATIO=16:9, QTY=1, IMAGE_PATH=C:\Desktop\ref.jpg

**"Lưu kết quả về D:\output"**
→ OUTPUT_FOLDER=D:\output

## App Windows

Chạy app giao diện: `npm run start-app` (từ thư mục gốc dự án).
Build executable: `cd app && npm run build-portable`
