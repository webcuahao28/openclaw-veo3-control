/**
 * select-start-frame.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Trong chế độ Video, click nút "Bắt đầu" → popup chọn ảnh mở ra →
 * upload ảnh chỉ định làm Start Frame (khung hình đầu tiên).
 *
 * Dùng cho Phase 2 của workflow: mỗi ảnh đã gen từ Phase 1 sẽ được
 * dùng làm Start Frame cho một lần tạo video riêng.
 *
 * Cách dùng: node select-start-frame.js "<đường_dẫn_ảnh>"
 * ─────────────────────────────────────────────────────────────────────────────
 */
const CDP = require('chrome-remote-interface');
const path = require('path');
const fs   = require('fs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({type: 'mouseMoved',    x, y});
  await sleep(80);
  await Input.dispatchMouseEvent({type: 'mousePressed',  x, y, button: 'left', clickCount: 1});
  await sleep(80);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
}

async function waitForElement(Runtime, expression, maxRetries = 15, delayMs = 600) {
  for (let i = 0; i < maxRetries; i++) {
    const { result } = await Runtime.evaluate({ expression });
    if (result && result.value) return JSON.parse(result.value);
    await sleep(delayMs);
  }
  return null;
}

const rawPath = process.argv[2];

(async function selectStartFrame() {
  let client;
  try {
    console.log(`\n=== 🎬 SELECT START FRAME ===`);

    if (!rawPath) throw new Error('Thiếu đường dẫn ảnh! Dùng: node select-start-frame.js "<path>"');

    const absolutePath = path.resolve(rawPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Không tìm thấy file: ${absolutePath}`);
    }
    console.log(`  → Ảnh: ${absolutePath}`);

    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const { Runtime, Input, Page, DOM } = client;
    await Runtime.enable();
    await Page.enable();
    await DOM.enable();

    // ─────────────────────────────────────────────────────────────
    // BƯỚC 1: TÌM VÀ CLICK NÚT "Bắt đầu"
    // Selector: div có text "Bắt đầu" bên trong container
    // ─────────────────────────────────────────────────────────────
    console.log(`  → Tìm nút "Bắt đầu"...`);

    const startBtnExpr = `
      (() => {
        // Tìm tất cả div/button có text chính xác "Bắt đầu"
        const candidates = Array.from(document.querySelectorAll('div[type="button"], button, div[role="button"]'));
        const btn = candidates.find(el => {
          const text = (el.textContent || '').trim();
          return text === 'Bắt đầu' || text === 'Start';
        });
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        if (r.width === 0) return null;
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()
    `;

    const startBtnPos = await waitForElement(Runtime, startBtnExpr, 10, 600);
    if (!startBtnPos) throw new Error('Không tìm thấy nút "Bắt đầu" trên giao diện!');

    console.log(`  → Click "Bắt đầu" tại (${Math.round(startBtnPos.x)}, ${Math.round(startBtnPos.y)})...`);
    await clickAt(Input, startBtnPos.x, startBtnPos.y);
    await sleep(1500); // Chờ popup animation

    // ─────────────────────────────────────────────────────────────
    // BƯỚC 2: KIỂM TRA POPUP ĐÃ MỞ CHƯA
    // Popup có class chứa "sc-903adef0" hoặc có input tìm kiếm
    // ─────────────────────────────────────────────────────────────
    console.log(`  → Kiểm tra popup đã mở...`);

    const popupExpr = `
      (() => {
        const input = document.querySelector('input[placeholder*="Tìm kiếm"], input[placeholder*="Search"]');
        if (input) {
          const r = input.getBoundingClientRect();
          return JSON.stringify({ found: r.width > 0 });
        }
        // Fallback: tìm container popup
        const popup = Array.from(document.querySelectorAll('div')).find(d => {
          const r = d.getBoundingClientRect();
          return r.width > 200 && r.height > 200 &&
                 d.querySelector('button') &&
                 d.querySelector('img[src*="trpc"]');
        });
        return popup ? JSON.stringify({ found: true }) : null;
      })()
    `;
    const popupState = await waitForElement(Runtime, popupExpr, 8, 500);
    if (!popupState || !popupState.found) {
      throw new Error('Popup "Bắt đầu" không mở được!');
    }
    console.log(`  ✓ Popup đã mở.`);

    // ─────────────────────────────────────────────────────────────
    // BƯỚC 3: CÁCH 1 — TÌM input[type=file] ẨN VÀ BƠM TRỰC TIẾP
    // Google Labs thường có một hidden <input type="file"> trong popup
    // ─────────────────────────────────────────────────────────────
    console.log(`  → Tìm thẻ input[type=file] ẩn trong popup...`);

    const { root } = await DOM.getDocument({ depth: -1 });
    const { nodeId: fileInputNodeId } = await DOM.querySelector({
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    });

    if (fileInputNodeId) {
      console.log(`  → Thẻ file input ẩn tìm thấy. Bơm trực tiếp...`);
      await DOM.setFileInputFiles({
        files: [absolutePath],
        nodeId: fileInputNodeId
      });
      console.log(`  → Chờ ảnh load vào popup (5 giây)...`);
      await sleep(5000);
      console.log(`  ✅ HOÀN TẤT (trực tiếp)!`);
      console.log(`===============================\n`);
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // BƯỚC 4: CÁCH 2 — TÌM NÚT "Tải hình ảnh lên" TRONG POPUP
    // Click nút → Intercept file chooser dialog → Đẩy file
    // ─────────────────────────────────────────────────────────────
    console.log(`  → Không có thẻ ẩn. Tìm nút upload trong popup...`);

    const uploadBtnExpr = `
      (() => {
        // Tìm button có icon "upload" hoặc text "Tải hình ảnh lên"
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => {
          const icon = b.querySelector('i');
          if (icon && icon.textContent.trim().toLowerCase() === 'upload') return true;
          const span = b.querySelector('span');
          if (span) {
            const t = span.textContent.toLowerCase();
            if (t.includes('tải hình') || t.includes('upload') || t.includes('tải lên')) return true;
          }
          return false;
        });
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        if (r.width === 0) return null;
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()
    `;

    const uploadBtnPos = await waitForElement(Runtime, uploadBtnExpr, 8, 500);
    if (!uploadBtnPos) {
      // Click ra ngoài để đóng popup trước khi throw
      await clickAt(Input, 50, 50);
      throw new Error('Không tìm thấy nút "Tải hình ảnh lên" trong popup!');
    }

    // Bật intercept TRƯỚC khi click
    await Page.setInterceptFileChooserDialog({ enabled: true });
    let fileUploaded = false;

    Page.fileChooserOpened(async (params) => {
      console.log(`  → File chooser bị bắt. Đẩy file vào...`);
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

    console.log(`  → Click nút "Tải hình ảnh lên"...`);
    await clickAt(Input, uploadBtnPos.x, uploadBtnPos.y);

    // Chờ file được đẩy (tối đa 8 giây)
    for (let i = 0; i < 8; i++) {
      await sleep(1000);
      if (fileUploaded) break;
    }

    await Page.setInterceptFileChooserDialog({ enabled: false });

    if (!fileUploaded) {
      throw new Error('File chooser không được trigger hoặc quá timeout!');
    }

    console.log(`  → Chờ ảnh load vào popup (5 giây)...`);
    await sleep(5000);
    console.log(`  ✅ HOÀN TẤT (intercept)!`);
    console.log(`===============================\n`);

  } catch (err) {
    console.error('\n  ❌ LỖI SELECT START FRAME:', err.message);
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
