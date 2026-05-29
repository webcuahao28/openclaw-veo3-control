// Thay bằng URL Webhook thực tế của bạn (có thể override bằng biến môi trường WEBHOOK_URL khi test local)
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbzxYh83welrm_o-p5j5GNy5nAm0QsFHVMFvmgjN-PsfZjevLEWw0A9FLqS9WslHyh3j_Q/exec';

async function main() {
    // 1. Lấy tham số từ dòng lệnh (Bỏ qua 'node' và 'tên file')
    const args = process.argv.slice(2);
    const mode = args[0];     // VD: 'image' hoặc 'video'
    const product = args[1];  // VD: 'hat' hoặc 'sunglasses'
    const context = args[2];  // VD: 'in the car' (Có thể có hoặc không)

    // 2. Kiểm tra đầu vào cơ bản
    if (!mode || !product) {
        console.error('\n❌ LỖI: Thiếu tham số bắt buộc.');
        console.error('👉 Cú pháp chuẩn: node get-random-prompt.js <mode> <product> "[context]"');
        console.error('👉 Ví dụ: node get-random-prompt.js video hat "in the car"\n');
        process.exit(1);
    }

    console.log(`\n=== 🎲 BẮT ĐẦU LẤY PROMPT TỪ GOOGLE SHEET ===`);
    console.log(`  → Mode yêu cầu   : ${mode.toUpperCase()}`);
    console.log(`  → Sản phẩm       : ${product}`);
    console.log(`  → Ngữ cảnh (Lọc) : ${context ? `"${context}"` : 'Không áp dụng (Lấy ngẫu nhiên)'}`);
    console.log(`  → Đang kết nối API...`);

    try {
        // 3. Xây dựng URL chuẩn xác và an toàn
        const urlObj = new URL(WEBHOOK_URL);
        urlObj.searchParams.append('mode', mode.trim());
        urlObj.searchParams.append('product', product.trim());
        
        if (context && context.trim() !== "") {
            urlObj.searchParams.append('context', context.trim());
        }

        // 4. Thiết lập Timeout 15 giây (Tránh treo bot nếu rớt mạng)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        // 5. Gọi API
        const response = await fetch(urlObj.toString(), {
            signal: controller.signal
        });
        
        // Hủy timeout nếu gọi API thành công trước 15s
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Lỗi kết nối HTTP: ${response.status} - ${response.statusText}`);
        }

        // 6. Xử lý dữ liệu trả về từ Google Apps Script
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || "Lỗi không xác định từ Google Sheet");
        }

        console.log(`  ✅ Lấy dữ liệu thành công!`);
        console.log(`  📝 Nội dung Prompt:`);
        console.log(`     "${result.prompt}"`);
        console.log(`==============================================\n`);

        // 7. IN RA JSON CHUẨN Ở DÒNG CUỐI (Dành riêng cho Bot OpenClaw đọc)
        const outputObj = {
            hasPrompt: true,
            mode: result.mode,
            product: result.product,
            context: result.context,
            promptText: result.prompt
        };

        console.log(JSON.stringify(outputObj));
        process.exit(0); // Kết thúc thành công

    } catch (error) {
        let errorMessage = error.message;
        
        // Xử lý riêng lỗi Timeout
        if (error.name === 'AbortError') {
            errorMessage = "Quá thời gian kết nối (15 giây). Vui lòng kiểm tra lại mạng hoặc Google Sheet.";
        }

        console.error(`\n❌ THẤT BẠI: ${errorMessage}\n`);

        // In JSON báo lỗi để AI biết đường xử lý tiếp
        console.log(JSON.stringify({
            hasPrompt: false,
            error: errorMessage
        }));
        
        process.exit(1); // Kết thúc với mã lỗi
    }
}

// Chạy script
main();