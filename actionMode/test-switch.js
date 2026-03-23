const CDP = require('chrome-remote-interface');

// Hàm tiện ích để chờ
function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)); 
}

// Hàm đổi Mode đã được tinh chỉnh
async function switchMode(Runtime, Input, targetMode) {
  console.log(`\n  → Bắt đầu thao tác đổi sang mode: ${targetMode}`);

  // 1. Tìm vị trí nút Menu chính
  const {result: menuBtnRes} = await Runtime.evaluate({
    expression: `
      (() => {
        const btns = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
        const btn = btns.find(b => {
          const text = b.textContent.toLowerCase();
          return text.includes('nano banana') || text.includes('video') || text.includes('veo');
        });
        if (!btn) return null;
        
        const r = btn.getBoundingClientRect();
        return JSON.stringify({
          x: r.left + r.width/2, 
          y: r.top + r.height/2, 
          currentText: btn.textContent
        });
      })()
    `
  });

  if (!menuBtnRes || !menuBtnRes.value) throw new Error('Không tìm thấy nút Menu chọn Mode!');
  const menuPos = JSON.parse(menuBtnRes.value);
  console.log(`  → Click mở menu tại (${Math.round(menuPos.x)}, ${Math.round(menuPos.y)}) - Đang ở: ${menuPos.currentText.trim()}`);

  // Mô phỏng click mở menu
  await Input.dispatchMouseEvent({type: 'mouseMoved', x: menuPos.x, y: menuPos.y});
  await sleep(200);
  await Input.dispatchMouseEvent({type: 'mousePressed', x: menuPos.x, y: menuPos.y, button: 'left', clickCount: 1});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x: menuPos.x, y: menuPos.y, button: 'left', clickCount: 1});
  
  // Đợi animation menu xổ xuống (tăng thời gian chờ lên một chút để đảm bảo DOM kịp render)
  await sleep(800); 

  // 2. Tìm vị trí tab Hình ảnh hoặc Video trong menu
  const {result: tabBtnRes} = await Runtime.evaluate({
    expression: `
      (() => {
        // Chuyển targetMode thành chuỗi tìm kiếm, so sánh không phân biệt hoa thường
        const searchKeywords = "${targetMode}" === 'VIDEO' ? ['video'] : ['hình', 'ảnh'];
        
        // Tìm tất cả các button có role tab
        const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
        
        const btn = tabs.find(b => {
          const text = b.textContent.toLowerCase();
          // Kiểm tra xem text của nút có chứa TẤT CẢ các từ khóa tìm kiếm hay không
          return searchKeywords.every(kw => text.includes(kw));
        });
        
        if (!btn) return null;

        const r = btn.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
      })()
    `
  });

  if (!tabBtnRes || !tabBtnRes.value) {
    // In ra danh sách các tab đang có để dễ debug nếu vẫn lỗi
    const {result: debugTabs} = await Runtime.evaluate({
      expression: `Array.from(document.querySelectorAll('button[role="tab"]')).map(b => b.textContent).join(' | ')`
    });
    console.log(`  🔍 Log debug - Các tab tìm thấy: ${debugTabs.value}`);

    // Thoát menu nếu lỗi để tránh kẹt giao diện
    await Input.dispatchMouseEvent({type: 'mousePressed', x: 0, y: 0, button: 'left', clickCount: 1});
    await Input.dispatchMouseEvent({type: 'mouseReleased', x: 0, y: 0, button: 'left', clickCount: 1});
    throw new Error(`Không tìm thấy tab ${targetMode} trong menu!`);
  }
  
  const tabPos = JSON.parse(tabBtnRes.value);
  console.log(`  → Click chọn tab ${targetMode} tại (${Math.round(tabPos.x)}, ${Math.round(tabPos.y)})`);

  // Mô phỏng click chọn Tab
  await Input.dispatchMouseEvent({type: 'mouseMoved', x: tabPos.x, y: tabPos.y});
  await sleep(300);
  await Input.dispatchMouseEvent({type: 'mousePressed', x: tabPos.x, y: tabPos.y, button: 'left', clickCount: 1});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x: tabPos.x, y: tabPos.y, button: 'left', clickCount: 1});
  
  // Đợi UI cập nhật xong nút thành mode mới
  await sleep(800); 
  console.log(`  → ✓ Chuyển đổi thành công sang mode: ${targetMode}`);
}

// Script chạy chính
(async function runTest() {
  let client;
  try {
    console.log('=== BẮT ĐẦU TEST ĐỔI MODE ===');
    
    // Lấy danh sách các tab đang mở qua cổng 9222
    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    
    if (!flowTab) {
      throw new Error('Không tìm thấy tab labs.google! Hãy chắc chắn bạn đã mở trình duyệt và truy cập trang web.');
    }
    
    console.log(`  🔗 Đã kết nối với tab: ${flowTab.title}`);
    
    // Kết nối vào tab đó
    client = await CDP({target: flowTab.id, port: 9222});
    const {Runtime, Input} = client;
    await Runtime.enable();

    // Thực hiện Test 1: Chuyển sang VIDEO
    await switchMode(Runtime, Input, 'VIDEO');
    
    // Đợi 3 giây cho bạn nhìn rõ kết quả
    console.log('\n  ⏳ Chờ 3 giây trước khi đổi lại...');
    await sleep(3000);

    // Thực hiện Test 2: Chuyển về HÌNH ẢNH (IMAGE)
    await switchMode(Runtime, Input, 'IMAGE');
    
    console.log('\n=== HOÀN THÀNH TEST! ===');

  } catch (err) {
    console.error('\n❌ Lỗi trong quá trình test:', err.message);
  } finally {
    if (client) {
      await client.close();
    }
  }
})();