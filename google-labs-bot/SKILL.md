---
name: google-labs-bot
description: Tạo video/ảnh trên Google Labs từ Telegram. Lấy prompt từ Google Sheet, điều khiển Chrome upload ảnh và submit prompt. Trigger khi người dùng nói "tạo ảnh", "tạo video", "làm video", "gen ảnh", "gen video", "google labs", "veo", "imagen".

---

# Google Labs Bot — Skill điều khiển Chrome tạo video/ảnh

## Tổng quan

Skill này tự động hóa quy trình tạo ảnh/video trên Google Labs bằng cách:
1. Lấy prompt ngẫu nhiên từ Google Sheet (có hỗ trợ lọc theo ngữ cảnh)
2. Setup trình duyệt Chrome đúng mode
3. Upload ảnh tham chiếu (nếu có)
4. Nhập prompt và submit

## Đường dẫn script

- **Get prompt:** `C:\Users\ADMIN\openClawVeo3\checkTasks\get-random-prompt.js`
- **Setup browser:** `C:\Users\ADMIN\openClawVeo3\actionMode\setup-bot-action-mode.js`
- **Upload image:** `C:\Users\ADMIN\openClawVeo3\actionMode\upload-image.js`
- **Input & submit:** `C:\Users\ADMIN\openClawVeo3\actionMode\action-input-prompt.js`

## QUY TẮC BẮT BUỘC

1. **LUÔN dùng exec với `elevated:true` và `pty:true`** — trên Windows, không có pty thì không nhận được output.
2. **TUYỆT ĐỐI KHÔNG tự tạo hay chỉnh sửa file.** Chỉ dùng đúng các script Node.js được liệt kê ở trên.
3. **KHÔNG chạy gộp nhiều lệnh cùng lúc.** Mỗi lần chỉ chạy 1 lệnh duy nhất.
4. **CHỜ XONG MỚI CHẠY TIẾP.** Sau mỗi lệnh exec, bắt buộc đọc output trả về hoàn chỉnh rồi mới được chạy lệnh tiếp theo.
5. **KHÔNG được báo "Đã xong" khi chưa chạy xong bước cuối cùng.**

## Tham số

- **MODE:** `image` hoặc `video` — tùy người dùng yêu cầu tạo ảnh hay video.
- **PRODUCT:** tên sản phẩm (VD: `hat`, `sunglasses`, `bag`).
- **CONTEXT** (tùy chọn): ngữ cảnh chụp — `outdoor`, `in the car`, `in the store`, `beach`, v.v.
- **QUANTITY:** số lượng cần gen (mặc định: x1).
- **IMAGE_PATH:** đường dẫn ảnh để upload (nếu có).

## Quy trình thực thi — TỪNG BƯỚC MỘT

### Bước 1: Lấy Prompt

Chạy exec để lấy prompt ngẫu nhiên từ Google Sheet.

**Nếu CÓ ngữ cảnh:**
```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\checkTasks\get-random-prompt.js [MODE] [PRODUCT] \"[CONTEXT]\""
```

**Nếu KHÔNG có ngữ cảnh:**
```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\checkTasks\get-random-prompt.js [MODE] [PRODUCT]"
```

**Sau khi chạy xong:** Đọc JSON trả về, lưu giá trị `promptText`. Nếu có lỗi → DỪNG LẠI, báo người dùng.

### Bước 2: Setup trình duyệt

```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\actionMode\setup-bot-action-mode.js [MODE] x[QUANTITY]"
```

**Chờ log báo setup thành công mới đi tiếp.**

### Bước 3: Upload ảnh (CHỈ KHI người dùng cung cấp ảnh)

```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\actionMode\upload-image.js \"[IMAGE_PATH]\""
```

**Chờ log báo upload xong. Nếu không có ảnh → bỏ qua bước này.**

### Bước 4: Nhập prompt và Submit

Dùng `promptText` đã lấy ở Bước 1:

```
exec elevated:true pty:true command:"node C:\Users\ADMIN\openClawVeo3\actionMode\action-input-prompt.js \"[PROMPTTEXT]\" 70"
```

**BẮT BUỘC chờ terminal báo "HOÀN TẤT NHẬP VÀ GỬI PROMPT" mới được qua bước tiếp.**

### Bước 5: Báo cáo

Trả lời người dùng: đã hoàn thành. Nêu tóm tắt prompt đã dùng và kết quả.

## Ví dụ sử dụng

**Người dùng:** "Tạo ảnh hat outdoor"
→ MODE=image, PRODUCT=hat, CONTEXT=outdoor, QUANTITY=1

**Người dùng:** "Làm video sunglasses trong xe, 3 cái"
→ MODE=video, PRODUCT=sunglasses, CONTEXT=in the car, QUANTITY=3

**Người dùng:** "Gen ảnh bag" (không context)
→ MODE=image, PRODUCT=bag, QUANTITY=1

**Người dùng:** "Tạo video hat beach, dùng ảnh C:\Users\ADMIN\Desktop\tasks\hat-photo.jpg"
→ MODE=video, PRODUCT=hat, CONTEXT=beach, IMAGE_PATH=C:\Users\ADMIN\Desktop\tasks\hat-photo.jpg
