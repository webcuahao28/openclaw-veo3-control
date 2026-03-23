const CDP = require('chrome-remote-interface');

// Hàm tiện ích chờ
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Hàm giả lập di chuột và click
async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({type: 'mouseMoved', x, y});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mousePressed', x, y, button: 'left', clickCount: 1});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
}

// Hàm giả lập gõ phím người thật
async function typeTextSimulated(Input, text) {
  if (!text) return;
  for (const char of text) {
    await Input.dispatchKeyEvent({type: 'keyDown', text: char});
    await Input.dispatchKeyEvent({type: 'keyUp', text: char});
    await sleep(Math.floor(Math.random() * 60) + 30);
  }
}

(async function inputAndSubmit() {
  const promptText = process.argv[2];
  const pastePercentage = process.argv[3] ? parseInt(process.argv[3], 10) : 50; 

  let client;
  try {
    console.log(`\n=== ⌨️ ACTION: NHẬP PROMPT & SUBMIT (HỖ TRỢ VIDEO MODE) ===`);
    
    if (!promptText) {
      throw new Error('Chưa cung cấp nội dung Prompt!');
    }
    
    // Tính toán chia mảng: Type Đầu -> Paste Giữa -> Type Đuôi
    const safePercentage = Math.max(0, Math.min(100, pastePercentage));
    const pasteLength = Math.floor(promptText.length * (safePercentage / 100));
    const totalTypeLength = promptText.length - pasteLength;
    
    const typeFirstLength = Math.floor(totalTypeLength / 2);
    
    const typeFirstText = promptText.substring(0, typeFirstLength);
    const pasteText = promptText.substring(typeFirstLength, typeFirstLength + pasteLength);
    const typeLastText = promptText.substring(typeFirstLength + pasteLength);

    console.log(`  → Tổng độ dài: ${promptText.length} ký tự`);
    console.log(`  → Tỉ lệ Paste: ${safePercentage}%`);

    // Kết nối Trình duyệt
    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const {Runtime, Input} = client;
    await Runtime.enable();

    // 1. TÌM SLATE EDITOR (CẬP NHẬT RIÊNG CHO CẤU TRÚC TAB VIDEO)
    const {result: editorRes} = await Runtime.evaluate({
      expression: `
        (() => {
          // Lọc chính xác các thẻ div đóng vai trò là textbox nhập liệu
          const editors = Array.from(document.querySelectorAll('div[role="textbox"][data-slate-editor="true"][contenteditable="true"]'));
          const visibleEditors = editors.filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0);
          
          let el = visibleEditors.find(e => {
            // Tìm chữ placeholder mờ "Bạn muốn tạo gì?" ngay bên trong ô đó
            const ph = e.querySelector('[data-slate-placeholder="true"]');
            return ph && (ph.textContent.includes('Bạn muốn tạo gì') || ph.textContent.toLowerCase().includes('create'));
          });
          
          // Nếu không tìm thấy bằng placeholder, lấy ô to nhất (thường là ô nhập liệu chính)
          if (!el && visibleEditors.length > 0) {
             el = visibleEditors.reduce((prev, current) => {
                const prevRect = prev.getBoundingClientRect();
                const currRect = current.getBoundingClientRect();
                return (prevRect.width * prevRect.height > currRect.width * currRect.height) ? prev : current;
             });
          }
          
          if (!el) return null;
          
          // Tính toán toạ độ: Tránh bị dính vào viền trên (có thể chạm nhầm nút Bắt đầu/Kết thúc ở tab Video)
          const r = el.getBoundingClientRect();
          // Chuyển tâm click xuống 1/3 phía dưới của ô text để an toàn tuyệt đối
          return JSON.stringify({
            x: r.left + r.width / 2, 
            y: r.top + (r.height * 0.7) 
          });
        })()
      `
    });

    if (!editorRes.value) throw new Error('Không tìm thấy ô nhập liệu chính!');
    const editorPos = JSON.parse(editorRes.value);
    console.log(`  → Tìm thấy Editor tại (${Math.round(editorPos.x)}, ${Math.round(editorPos.y)}) - Tránh nút Video`);

    // 2. Click Focus và Xoá Text Cũ
    await clickAt(Input, editorPos.x, editorPos.y);
    await sleep(400); // Chờ UI của Tab Video phản hồi mở rộng (nếu có)
    
    await Input.dispatchKeyEvent({type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 0});
    await Input.dispatchKeyEvent({type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 8});
    await Input.dispatchKeyEvent({type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 8});
    await Input.dispatchKeyEvent({type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0});
    await sleep(200);
    await Input.dispatchKeyEvent({type: 'keyDown', key: 'Delete', code: 'Delete'});
    await Input.dispatchKeyEvent({type: 'keyUp', key: 'Delete', code: 'Delete'});
    await sleep(300);

    // 3. THỰC THI NHẬP LIỆU
    if (typeFirstText.length > 0) {
      console.log(`  → Đang Gõ phần đầu...`);
      await typeTextSimulated(Input, typeFirstText);
      await sleep(200);
    }

    if (pasteText.length > 0) {
      console.log(`  → Đang Paste phần giữa...`);
      await Input.insertText({ text: pasteText });
      await sleep(300);
    }

    if (typeLastText.length > 0) {
      console.log(`  → Đang Gõ phần cuối...`);
      await typeTextSimulated(Input, typeLastText);
      await sleep(200);
    }
    await sleep(500);

    // 4. TÌM VÀ CLICK NÚT SUBMIT (Hỗ trợ cấu trúc icon arrow_forward mới)
    const {result: submitRes} = await Runtime.evaluate({
      expression: `
        (() => {
          const allBtns = Array.from(document.querySelectorAll('button'));
          const btn = allBtns.find(b => {
            if (b.disabled) return false;
            const icon = b.querySelector('i');
            return icon && icon.textContent.trim() === 'arrow_forward';
          });
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
        })()
      `
    });

    if (!submitRes.value) throw new Error('Không tìm thấy nút Submit (arrow_forward)!');
    const submitPos = JSON.parse(submitRes.value);
    
    console.log(`  → Click nút Submit...`);
    await clickAt(Input, submitPos.x, submitPos.y);
    
    console.log(`  ✅ HOÀN TẤT NHẬP VÀ GỬI PROMPT!`);
    console.log(`=======================================\n`);

  } catch (err) {
    console.error('\n  ❌ LỖI INPUT:', err.message);
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();