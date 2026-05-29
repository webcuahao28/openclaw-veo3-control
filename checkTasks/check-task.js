// file: check-task.js
// Điền cái link Webhook (Deploy mới) của bạn vào đây (có thể override bằng biến môi trường WEBHOOK_URL khi test local)
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbzxYh83welrm_o-p5j5GNy5nAm0QsFHVMFvmgjN-PsfZjevLEWw0A9FLqS9WslHyh3j_Q/exec';

async function checkTask() {
  try {
    const response = await fetch(WEBHOOK_URL);
    const result = await response.json();

    if (!result.success) {
      throw new Error("Lỗi từ Google Sheet: " + result.error);
    }

    if (result.data) {
      // CÓ TASK! In ra cho OpenClaw đọc
      console.log(`\n=== TÌM THẤY TASK MỚI ===`);
      console.log(`Row: ${result.data.row}`);
      console.log(`Prompt: ${result.data.prompt}`);
      console.log(`=========================\n`);
      
      // Mẹo: Bạn có thể in JSON thuần ở dòng cuối cùng để OpenClaw dùng Regex/JSON Parser bóc tách biến dễ hơn
      console.log(JSON.stringify({
        hasTask: true,
        row: result.data.row,
        prompt: result.data.prompt
      }));

      process.exit(0); // Exit code 0: Báo cho OpenClaw biết là chạy thành công (đi tiếp bước sau)
      
    } else {
      // HẾT TASK
      console.log(`\n😴 Hết việc! Không tìm thấy task nào ở trạng thái "Holding".\n`);
      console.log(JSON.stringify({ hasTask: false }));
      process.exit(1); // Exit code 1: Báo cho OpenClaw DỪNG LUỒNG tại đây (chờ chu kỳ sau chạy lại)
    }

  } catch (err) {
    console.error(`\n❌ Lỗi Fetch API: ${err.message}\n`);
    process.exit(1);
  }
}

checkTask();