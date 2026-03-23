const CDP = require('chrome-remote-interface');

(async function checkMode() {
  let client;
  try {
    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google đang mở!');

    client = await CDP({target: flowTab.id, port: 9222});
    const {Runtime} = client;
    await Runtime.enable();

    const {result} = await Runtime.evaluate({
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
          const btn = btns.find(b => {
            const text = b.textContent.toLowerCase();
            return text.includes('nano banana') || text.includes('video') || text.includes('veo');
          });
          if (!btn) return 'Không tìm thấy nút Mode';
          return btn.textContent.trim();
        })()
      `
    });

    const currentText = result.value;
    console.log(`\n=== TRẠNG THÁI HIỆN TẠI ===`);
    console.log(`  → Text đang hiển thị: "${currentText}"`);

    if (currentText.toLowerCase().includes('nano banana') || currentText.toLowerCase().includes('hình ảnh')) {
      console.log(`  → 🖼️ KẾT LUẬN: Đang ở mode HÌNH ẢNH (IMAGE)`);
    } else if (currentText.toLowerCase().includes('video') || currentText.toLowerCase().includes('veo')) {
      console.log(`  → 🎬 KẾT LUẬN: Đang ở mode VIDEO`);
    } else {
      console.log(`  → ❓ KẾT LUẬN: Không xác định được (Có thể UI vừa thay đổi)`);
    }
    console.log(`===========================\n`);

  } catch (err) {
    console.error('❌ Lỗi:', err.message);
  } finally {
    if (client) await client.close();
  }
})();