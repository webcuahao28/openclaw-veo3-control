const CDP = require('chrome-remote-interface');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// LẤY THAM SỐ TỪ COMMAND LINE (ví dụ: x1, x2, x4)
// process.argv[2] chính là giá trị bạn gõ vào sau tên file
const targetQuantity = process.argv[2] ? process.argv[2].toLowerCase() : 'x1'; // Mặc định là x1 nếu quên truyền

(async function setQuantity() {
  let client;
  try {
    console.log(`\n=== ĐỔI SỐ LƯỢNG SANG: ${targetQuantity.toUpperCase()} ===`);
    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const {Runtime, Input} = client;
    await Runtime.enable();

    // 1. Tìm và click mở menu (Giả sử menu đã nằm trên màn hình)
    const {result: menuBtnRes} = await Runtime.evaluate({
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
          const btn = btns.find(b => /nano banana|video|veo/i.test(b.textContent));
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
        })()
      `
    });

    if (!menuBtnRes.value) throw new Error('Không tìm thấy nút Menu!');
    const menuPos = JSON.parse(menuBtnRes.value);
    
    await Input.dispatchMouseEvent({type: 'mouseMoved', x: menuPos.x, y: menuPos.y});
    await sleep(200);
    await Input.dispatchMouseEvent({type: 'mousePressed', x: menuPos.x, y: menuPos.y, button: 'left', clickCount: 1});
    await sleep(100);
    await Input.dispatchMouseEvent({type: 'mouseReleased', x: menuPos.x, y: menuPos.y, button: 'left', clickCount: 1});
    
    await sleep(800); // Chờ menu xổ xuống

    // 2. TÌM VÀ CLICK NÚT SỐ LƯỢNG (Dựa vào biến targetQuantity truyền từ ngoài vào)
    const {result: qtyBtnRes} = await Runtime.evaluate({
      expression: `
        (() => {
          const qtyToFind = "${targetQuantity}"; // Lấy biến từ Node.js đưa vào trình duyệt
          const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
          const btn = tabs.find(b => b.textContent.trim().toLowerCase() === qtyToFind);
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
        })()
      `
    });

    if (!qtyBtnRes.value) throw new Error(`Không tìm thấy nút số lượng ${targetQuantity.toUpperCase()}!`);
    const qtyPos = JSON.parse(qtyBtnRes.value);

    await Input.dispatchMouseEvent({type: 'mouseMoved', x: qtyPos.x, y: qtyPos.y});
    await sleep(300);
    await Input.dispatchMouseEvent({type: 'mousePressed', x: qtyPos.x, y: qtyPos.y, button: 'left', clickCount: 1});
    await sleep(100);
    await Input.dispatchMouseEvent({type: 'mouseReleased', x: qtyPos.x, y: qtyPos.y, button: 'left', clickCount: 1});

    await sleep(500);
    console.log(`  → ✓ Đã chọn thành công: ${targetQuantity.toUpperCase()}\n`);

  } catch (err) {
    console.error('  → ❌ Lỗi:', err.message);
  } finally {
    if (client) await client.close();
  }
})();