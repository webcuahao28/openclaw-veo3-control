// flowMode/upload-image.js
// Uploads a reference image to the Flow generation panel.
// Usage: node flowMode/upload-image.js "C:\path\to\image.jpg"

const CDP  = require('chrome-remote-interface');
const path = require('path');
const fs   = require('fs');
const { CDP_PORT, connect, sleep, waitForElement, clickAt } = require('./_cdp');

const rawPath = process.argv[2];

(async () => {
  let client;
  try {
    console.log('\n=== 🖼️ UPLOAD ẢNH THAM CHIẾU ===');
    if (!rawPath) { console.log('  → Bỏ qua: không có đường dẫn ảnh.'); process.exit(0); }

    const absPath = path.resolve(rawPath);
    if (!fs.existsSync(absPath)) throw new Error(`Không tìm thấy file: ${absPath}`);
    console.log(`  → File: ${absPath}`);

    client = await connect();
    const { Runtime, Input, DOM, Page } = client;

    // ── 1. Find the "+" / upload / Tác nhân button ─────────────────────────
    // In Flow the upload is typically triggered via a "+" button or "Tác nhân"
    const addBtnExpr = `(() => {
      const all = Array.from(document.querySelectorAll('button, [role="button"]'));
      const btn = all.find(el => {
        const icon = el.querySelector('mat-icon, i');
        const t = el.textContent || '';
        const lbl = el.getAttribute('aria-label') || '';
        return (icon && (icon.textContent.trim() === 'add_2' || icon.textContent.trim() === 'add_photo_alternate' || icon.textContent.trim() === 'photo_camera'))
          || t.includes('Tác nhân') || t.includes('Actor') || lbl.includes('upload') || lbl.includes('image');
      });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    console.log('  → Tìm nút thêm ảnh...');
    const addPos = await waitForElement(Runtime, addBtnExpr, 10, 400);
    if (!addPos) throw new Error('Không tìm thấy nút thêm ảnh/tác nhân!');
    await clickAt(Input, addPos.x, addPos.y);
    await sleep(1200);

    // ── 2. Strategy A: inject via hidden file input ─────────────────────────
    const { root } = await DOM.getDocument({ depth: -1 });
    const { nodeId } = await DOM.querySelector({ nodeId: root.nodeId, selector: 'input[type="file"]' });

    if (nodeId) {
      console.log('  → Tìm thấy input[type=file] ẩn, bơm trực tiếp...');
      await DOM.setFileInputFiles({ files: [absPath], nodeId });
      console.log('  → Đợi ảnh load (4 giây)...');
      await sleep(4000);
      console.log('  ✅ UPLOAD THÀNH CÔNG (strategy A)!');
      console.log(JSON.stringify({ success: true, file: path.basename(absPath), strategy: 'direct' }));
      return;
    }

    // ── 3. Strategy B: intercept file chooser dialog ────────────────────────
    console.log('  → Chuyển sang strategy B (intercept file dialog)...');
    await Page.setInterceptFileChooserDialog({ enabled: true });
    let uploaded = false;

    Page.fileChooserOpened(async ({ backendNodeId }) => {
      try {
        await DOM.setFileInputFiles({ files: [absPath], backendNodeId });
        uploaded = true;
      } catch (e) {
        console.error('  ❌ Lỗi khi đẩy file:', e.message);
      }
    });

    // Click "Upload from device" option inside the popup
    const uploadOptExpr = `(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const el = all.find(el => {
        const t = el.textContent.toLowerCase();
        const r = el.getBoundingClientRect();
        if (r.height > 80 || r.width === 0) return false;
        return t.includes('tải lên') || t.includes('upload') || t.includes('từ thiết bị') || t.includes('device');
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    const uploadPos = await waitForElement(Runtime, uploadOptExpr, 6, 400);
    if (uploadPos) { await clickAt(Input, uploadPos.x, uploadPos.y); }

    await sleep(5000);
    await Page.setInterceptFileChooserDialog({ enabled: false });

    if (!uploaded) throw new Error('File intercept thất bại hoặc timeout!');
    console.log('  ✅ UPLOAD THÀNH CÔNG (strategy B)!');
    console.log(JSON.stringify({ success: true, file: path.basename(absPath), strategy: 'intercept' }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
