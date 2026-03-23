const CDP = require('chrome-remote-interface');
const path = require('path');
const fs = require('fs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({type: 'mouseMoved', x, y});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mousePressed', x, y, button: 'left', clickCount: 1});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
}

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

const rawPath = process.argv[2];

(async function actionUploadImage() {
  let client;
  try {
    console.log(`\n=== 🖼️ ACTION: UPLOAD IMAGE ===`);
    
    if (!rawPath) {
      console.log(`  → Bỏ qua: Không có đường dẫn ảnh được truyền vào.`);
      process.exit(0);
    }
    
    const absolutePath = path.resolve(rawPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Không tìm thấy file ảnh tại máy tính: ${absolutePath}`);
    }
    console.log(`  → Target File: ${absolutePath}`);

    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const {Runtime, Input, Page, DOM} = client;
    
    await Runtime.enable();
    await Page.enable();
    await DOM.enable();

    // 1. Tìm và click nút "+" (add_2)
    const addBtnExpr = `
      (() => {
        const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const btn = btns.find(b => {
          const icon = b.querySelector('i');
          return icon && icon.textContent.trim() === 'add_2';
        });
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
      })()
    `;
    const addBtnPos = await waitForElement(Runtime, addBtnExpr, 10, 500);
    if (!addBtnPos) throw new Error('Không tìm thấy nút Thêm ảnh (add_2)!');
    
    console.log(`  → Click mở popup tải ảnh...`);
    await clickAt(Input, addBtnPos.x, addBtnPos.y);
    await sleep(1500); // Chờ popup xổ ra hoàn toàn

    // -------------------------------------------------------------------
    // CÁCH 1: TÌM THẺ <input type="file"> VÀ BƠM FILE TRỰC TIẾP (BYPASS)
    // -------------------------------------------------------------------
    console.log(`  → Đang dò tìm thẻ upload ẩn trong DOM...`);
    const { root } = await DOM.getDocument({ depth: -1 });
    const { nodeId } = await DOM.querySelector({
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    });

    if (nodeId) {
      console.log(`  → Đã tìm thấy thẻ input file ẩn. Đang bơm trực tiếp...`);
      await DOM.setFileInputFiles({
        files: [absolutePath],
        nodeId: nodeId
      });
      console.log(`  → Đợi ảnh được load lên UI (5 giây)...`);
      await sleep(5000);
      console.log(`  ✅ HOÀN TẤT UPLOAD TRỰC TIẾP!`);
      console.log(`===============================\n`);
      return; // Xong việc, thoát hàm luôn
    }

    // -------------------------------------------------------------------
    // CÁCH 2: NẾU KHÔNG CÓ THẺ ẨN, DÙNG BẪY INTERCEPT CỬA SỔ CHỌN FILE
    // -------------------------------------------------------------------
    console.log(`  → Không tìm thấy thẻ ẩn. Chuyển sang bẫy cửa sổ chọn file...`);
    await Page.setInterceptFileChooserDialog({enabled: true});
    
    let fileUploaded = false;
    Page.fileChooserOpened(async (params) => {
      console.log(`  → Đã chặn cửa sổ Windows. Đang đẩy file vào trình duyệt...`);
      try {
        await DOM.setFileInputFiles({
          files: [absolutePath],
          backendNodeId: params.backendNodeId
        });
        fileUploaded = true;
        console.log(`  → ✓ Đẩy file thành công!`);
      } catch (err) {
        console.error(`  → ❌ Lỗi khi đẩy file:`, err.message);
      }
    });

    // Biểu thức tìm nút thông minh: Tìm icon upload HOẶC các chữ liên quan
    const uploadBtnExpr = `
      (() => {
        const els = Array.from(document.querySelectorAll('*'));
        const btn = els.find(el => {
          if (el.tagName !== 'BUTTON' && el.tagName !== 'LI' && el.tagName !== 'DIV') return false;
          if (el.getBoundingClientRect().height > 80 || el.getBoundingClientRect().width === 0) return false;
          
          const icon = el.querySelector('i');
          if (icon && icon.textContent.trim().toLowerCase().includes('upload')) return true;
          
          const text = el.textContent.toLowerCase();
          if (text.includes('tải lên') || text.includes('upload') || text.includes('từ thiết bị') || text.includes('hình ảnh')) {
             return true;
          }
          return false;
        });
        
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
      })()
    `;
    
    const uploadBtnPos = await waitForElement(Runtime, uploadBtnExpr, 5, 500);
    if (!uploadBtnPos) {
      await clickAt(Input, 10, 10); // Click ra ngoài để đóng popup
      throw new Error('Không tìm thấy nút "Tải hình ảnh lên" bên trong popup!');
    }

    console.log(`  → Click nút Tải hình ảnh lên (Trigger Intercept)...`);
    await clickAt(Input, uploadBtnPos.x, uploadBtnPos.y); 
    
    console.log(`  → Đang chờ giao diện load ảnh (5 giây)...`);
    await sleep(5000); 
    
    if (!fileUploaded) {
       throw new Error('Quá trình Intercept file thất bại hoặc bị timeout!');
    }

    await Page.setInterceptFileChooserDialog({enabled: false});
    console.log(`  ✅ HOÀN TẤT UPLOAD BẰNG INTERCEPT!`);
    console.log(`===============================\n`);

  } catch (err) {
    console.error('\n  ❌ LỖI UPLOAD:', err.message);
    process.exit(1); 
  } finally {
    if (client) await client.close();
  }
})();