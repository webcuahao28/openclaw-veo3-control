const CDP = require('chrome-remote-interface');

// Hàm tiện ích chờ
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Lấy tham số từ Command Line
const targetMode = process.argv[2] ? process.argv[2].toLowerCase() : 'image'; 
const targetQuantity = process.argv[3] ? process.argv[3].toLowerCase() : 'x1'; 

// Hàm mô phỏng di chuột và click người thật
async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({type: 'mouseMoved', x, y});
  await sleep(200);
  await Input.dispatchMouseEvent({type: 'mousePressed', x, y, button: 'left', clickCount: 1});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
}

// Hàm Retry Evaluate: Lặp lại lệnh tìm kiếm element cho đến khi thấy hoặc timeout
async function waitForElement(Runtime, expression, maxRetries = 10, delayMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    const {result} = await Runtime.evaluate({ expression });
    if (result && result.value) {
      return JSON.parse(result.value);
    }
    await sleep(delayMs);
  }
  return null;
}

(async function setupBotAction() {
  let client;
  try {
    console.log(`\n=== 🚀 BẮT ĐẦU SETUP BOT ===`);
    console.log(`  🎯 Yêu cầu: Mode [${targetMode.toUpperCase()}] - Số lượng [${targetQuantity.toUpperCase()}]`);
    
    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const {Runtime, Input} = client;
    await Runtime.enable();

    // ==========================================
    // BƯỚC 1: MỞ MENU CHÍNH
    // ==========================================
    const menuExpression = `
      (() => {
        const btns = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
        const btn = btns.find(b => /nano banana|video|veo/i.test(b.textContent));
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
      })()
    `;
    
    const menuPos = await waitForElement(Runtime, menuExpression);
    if (!menuPos) throw new Error('Timeout: Không tìm thấy nút Menu chính!');
    
    console.log(`  → Click mở menu...`);
    await clickAt(Input, menuPos.x, menuPos.y);
    await sleep(1000); // Chờ menu xổ ra đầy đủ

    // ==========================================
    // BƯỚC 2: CHỌN MODE (IMAGE / VIDEO)
    // ==========================================
    const modeExpression = `
      (() => {
        const mode = "${targetMode}";
        const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
        const btn = tabs.find(b => {
           const t = b.textContent.toLowerCase();
           if (mode === 'video') return t.includes('video');
           return t.includes('hình') && t.includes('ảnh'); 
        });
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
      })()
    `;
    
    const modePos = await waitForElement(Runtime, modeExpression, 5, 500);
    if (!modePos) {
       await clickAt(Input, 0, 0); // Click ra ngoài nếu lỗi
       throw new Error(`Timeout: Không tìm thấy tab Mode [${targetMode}]!`);
    }
    
    console.log(`  → Đang chọn Mode: ${targetMode.toUpperCase()}`);
    await clickAt(Input, modePos.x, modePos.y);
    // Quan trọng: Chỉ chờ 1 giây để UI bên trong menu đổi tab, không gọi lệnh mở lại menu
    await sleep(1000); 

    // ==========================================
    // BƯỚC 3: CHỌN SỐ LƯỢNG NGAY TRONG MENU ĐANG MỞ
    // ==========================================
    const qtyExpression = `
      (() => {
        const qty = "${targetQuantity}";
        const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
        const btn = tabs.find(b => b.textContent.trim().toLowerCase() === qty);
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
      })()
    `;
    
    const qtyPos = await waitForElement(Runtime, qtyExpression, 5, 500);
    if (!qtyPos) {
      await clickAt(Input, 0, 0); 
      throw new Error(`Timeout: Không tìm thấy tab Số lượng [${targetQuantity}]!`);
    }
    
    console.log(`  → Đang chọn Số lượng: ${targetQuantity.toUpperCase()}`);
    await clickAt(Input, qtyPos.x, qtyPos.y);
    await sleep(500);

    // ==========================================
    // BƯỚC 4: ĐÓNG MENU (CLICK RA NGOÀI)
    // ==========================================
    console.log(`  → Đóng menu...`);
    // Click vào góc trên cùng bên trái màn hình (toạ độ 10, 10) để đóng popup menu an toàn
    await clickAt(Input, 10, 10);
    await sleep(500);

    console.log(`\n  ✅ HOÀN TẤT SETUP: Đã chuyển sang Mode [${targetMode.toUpperCase()}] với Số lượng [${targetQuantity.toUpperCase()}]`);
    console.log(`===================================\n`);

  } catch (err) {
    console.error('\n  ❌ LỖI SETUP:', err.message);
  } finally {
    if (client) await client.close();
  }
})();