/**
 * test-phase1.js  —  Test thủ công Phase 1 (Tạo 4 ảnh)
 * ─────────────────────────────────────────────────────────────────────────────
 * Gộp toàn bộ Phase 1 thành 1 script, dùng 1 CDP connection duy nhất:
 *   1. Lấy prompt ảnh từ Google Sheet
 *   2. Setup mode ảnh x4
 *   3. Upload ảnh gốc
 *   4. Nhập prompt & Submit
 *   5. Chờ 4 ảnh generation (2 phase)
 *   6. Tải 4 ảnh về máy
 *
 * Cách dùng:
 *   node test-phase1.js <image_path> <product> [context] [output_folder]
 *
 * Ví dụ:
 *   node test-phase1.js "C:\Tasks\hat_beach.jpg" hat beach
 *   node test-phase1.js "C:\Tasks\hat.jpg" hat "" "C:\Output\test"
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CDP  = require('chrome-remote-interface');
const path = require('path');
const fs   = require('fs');

// ═══════════════════════════════════════════════════════════════
// THAM SỐ ĐẦU VÀO
// ═══════════════════════════════════════════════════════════════
const IMAGE_PATH    = process.argv[2];
const PRODUCT       = process.argv[3] || 'product';
const CONTEXT       = process.argv[4] || '';
const OUTPUT_FOLDER = path.resolve(process.argv[5] || './test-phase1-output');
const MAX_WAIT_SEC  = parseInt(process.argv[6] || '300', 10);

// Webhook Google Sheet (lấy từ get-random-prompt.js)
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzxYh83welrm_o-p5j5GNy5nAm0QsFHVMFvmgjN-PsfZjevLEWw0A9FLqS9WslHyh3j_Q/exec';

// ═══════════════════════════════════════════════════════════════
// TIỆN ÍCH
// ═══════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const ts = new Date().toTimeString().split(' ')[0];
  console.log(`[${ts}] ${msg}`);
}

async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({type: 'mouseMoved',    x, y});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mousePressed',  x, y, button: 'left', clickCount: 1});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
}

async function waitForExpr(Runtime, expression, maxRetries = 15, delayMs = 600) {
  for (let i = 0; i < maxRetries; i++) {
    const { result } = await Runtime.evaluate({ expression });
    if (result && result.value) return JSON.parse(result.value);
    await sleep(delayMs);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// BƯỚC 1: LẤY PROMPT TỪ GOOGLE SHEET (không cần CDP)
// ═══════════════════════════════════════════════════════════════
async function getPrompt(product, context) {
  log(`[1/6] Lấy prompt ảnh từ Google Sheet (product="${product}", context="${context || 'none'}")`);

  const url = new URL(WEBHOOK_URL);
  url.searchParams.append('mode', 'image');
  url.searchParams.append('product', product.trim());
  if (context && context.trim()) url.searchParams.append('context', context.trim());

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);

  const res  = await fetch(url.toString(), { signal: controller.signal });
  clearTimeout(tid);

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Google Sheet trả về lỗi');

  log(`  ✓ Prompt: "${data.prompt.substring(0, 80)}..."`);
  return data.prompt;
}

// ═══════════════════════════════════════════════════════════════
// BƯỚC 2: SETUP MODE ẢNH x4
// ═══════════════════════════════════════════════════════════════
async function setupImageMode(Runtime, Input) {
  log(`[2/6] Setup mode: ảnh x4`);

  // Mở menu
  const menuPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
        .find(b => /nano banana|video|veo|image/i.test(b.textContent));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `);
  if (!menuPos) throw new Error('Không tìm thấy nút menu chính!');

  await clickAt(Input, menuPos.x, menuPos.y);
  await sleep(1000);

  // Chọn tab Hình ảnh
  const imgTabPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button[role="tab"]'))
        .find(b => { const t = b.textContent.toLowerCase(); return t.includes('hình') || t.includes('image'); });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `, 5, 500);
  if (!imgTabPos) { await clickAt(Input, 10, 10); throw new Error('Không tìm thấy tab Hình ảnh!'); }

  await clickAt(Input, imgTabPos.x, imgTabPos.y);
  await sleep(800);

  // Chọn số lượng x4
  const x4Pos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button[role="tab"]'))
        .find(b => b.textContent.trim().toLowerCase() === 'x4');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `, 5, 500);
  if (!x4Pos) { await clickAt(Input, 10, 10); throw new Error('Không tìm thấy nút x4!'); }

  await clickAt(Input, x4Pos.x, x4Pos.y);
  await sleep(500);

  // Đóng menu
  await clickAt(Input, 10, 10);
  await sleep(500);
  log(`  ✓ Đã chọn mode ảnh x4`);
}

// ═══════════════════════════════════════════════════════════════
// BƯỚC 3: UPLOAD ẢNH GỐC
// Flow: add_2 → dialog library → click upload icon → file picker
//       → set file → chờ item mới trong list → click item → dialog đóng
// ═══════════════════════════════════════════════════════════════
async function uploadImage(Runtime, Input, Page, DOM, imagePath) {
  const filename = path.basename(imagePath);
  log(`[3/6] Upload ảnh: ${filename}`);

  // ── 1. Click add_2 để mở dialog thư viện ──
  const addBtnPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => { const i = b.querySelector('i'); return i && i.textContent.trim() === 'add_2'; });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `, 10, 500);
  if (!addBtnPos) throw new Error('Không tìm thấy nút add_2!');

  await clickAt(Input, addBtnPos.x, addBtnPos.y);
  await sleep(1500); // chờ dialog library hiện

  // ── 2. Đếm số item hiện có trong list (để biết item mới sau upload) ──
  const { result: countRes } = await Runtime.evaluate({
    expression: `
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return '0';
        return String(dialog.querySelectorAll('[class*="sc-3038c00b-11"]').length);
      })()
    `
  });
  const itemsBefore = parseInt(countRes.value || '0', 10);
  log(`  → ${itemsBefore} ảnh trong thư viện`);

  // ── 3. Intercept file chooser ──
  await Page.setInterceptFileChooserDialog({ enabled: true });
  let fileChosen = false;

  Page.fileChooserOpened(async ({ backendNodeId }) => {
    try {
      await DOM.setFileInputFiles({ files: [imagePath], backendNodeId });
      fileChosen = true;
      log(`  ✓ File đã được chọn`);
    } catch (e) {
      log(`  ⚠️ setFileInputFiles error: ${e.message}`);
    }
  });

  // ── 4. Click nút upload (icon "upload") bên trong dialog ──
  const uploadBtnPos = await waitForExpr(Runtime, `
    (() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      const btn = Array.from(dialog.querySelectorAll('button'))
        .find(b => { const i = b.querySelector('i'); return i && i.textContent.trim() === 'upload'; });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `, 8, 500);

  if (!uploadBtnPos) {
    await Page.setInterceptFileChooserDialog({ enabled: false });
    await clickAt(Input, 10, 10);
    throw new Error('Không tìm thấy nút upload trong dialog!');
  }

  await clickAt(Input, uploadBtnPos.x, uploadBtnPos.y);

  // Chờ file chooser được xử lý (tối đa 8s)
  for (let i = 0; i < 16 && !fileChosen; i++) await sleep(500);
  await Page.setInterceptFileChooserDialog({ enabled: false });

  if (!fileChosen) {
    await clickAt(Input, 10, 10);
    throw new Error('Timeout: file chooser không mở hoặc không set được file!');
  }

  // ── 5. Chờ file upload lên server và hiện trong list ──
  log(`  → Chờ upload lên server...`);
  const filenameNoExt = filename.replace(/\.[^.]+$/, '').toLowerCase();

  const newItemPos = await waitForExpr(Runtime, `
    (() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      const items = Array.from(dialog.querySelectorAll('[class*="sc-3038c00b-11"]'));
      // Tìm item có alt chứa tên file (không phân biệt đuôi)
      const nameHint = "${filenameNoExt}";
      let item = items.find(el => {
        const img = el.querySelector('img');
        return img && img.alt && img.alt.toLowerCase().includes(nameHint);
      });
      // Fallback: item đầu tiên (mới nhất)
      if (!item && items.length > ${itemsBefore}) item = items[0];
      if (!item) return null;
      const r = item.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `, 20, 1000); // Tối đa 20s chờ server

  if (!newItemPos) {
    await clickAt(Input, 10, 10);
    throw new Error('Timeout: ảnh không xuất hiện trong thư viện sau khi upload!');
  }

  // ── 6. Click item trong list để SELECT → dialog tự đóng ──
  log(`  → Click chọn ảnh vừa upload...`);
  await clickAt(Input, newItemPos.x, newItemPos.y);
  await sleep(1500); // chờ dialog đóng và card ảnh gắn vào input

  // ── 7. Verify card ảnh đã gắn vào input area ──
  const { result: verifyRes } = await Runtime.evaluate({
    expression: `
      (() => {
        // Tìm card ảnh trong input area (nút có ảnh gắn kèm)
        const card = document.querySelector('button[data-card-open]');
        return card ? 'ok' : 'missing';
      })()
    `
  });
  if (verifyRes.value === 'ok') {
    log(`  ✓ Ảnh đã gắn vào input (card hiển thị)`);
  } else {
    log(`  ⚠️ Không thấy card ảnh — có thể đã ok nhưng UI chưa render`);
  }
}

// ═══════════════════════════════════════════════════════════════
// BƯỚC 4: NHẬP PROMPT VÀ SUBMIT
// ═══════════════════════════════════════════════════════════════
async function inputPromptAndSubmit(Runtime, Input, promptText) {
  log(`[4/6] Nhập prompt & submit (${promptText.length} ký tự)`);

  // Tìm Slate editor
  const { result: editorRes } = await Runtime.evaluate({
    expression: `
      (() => {
        const editors = Array.from(document.querySelectorAll('div[role="textbox"][data-slate-editor="true"][contenteditable="true"]'))
          .filter(e => e.getBoundingClientRect().width > 0);
        if (!editors.length) return null;
        const el = editors.find(e => {
          const ph = e.querySelector('[data-slate-placeholder="true"]');
          return ph && (ph.textContent.includes('Bạn muốn') || ph.textContent.toLowerCase().includes('create'));
        }) || editors.reduce((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return ra.width * ra.height > rb.width * rb.height ? a : b;
        });
        const r = el.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height * 0.7});
      })()
    `
  });
  if (!editorRes.value) throw new Error('Không tìm thấy ô nhập liệu!');
  const editorPos = JSON.parse(editorRes.value);

  // Focus + xoá text cũ
  await clickAt(Input, editorPos.x, editorPos.y);
  await sleep(400);
  await Input.dispatchKeyEvent({type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 0});
  await Input.dispatchKeyEvent({type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 8});
  await Input.dispatchKeyEvent({type: 'keyUp',   key: 'a', code: 'KeyA', modifiers: 8});
  await Input.dispatchKeyEvent({type: 'keyUp',   key: 'Control', code: 'ControlLeft', modifiers: 0});
  await sleep(200);
  await Input.dispatchKeyEvent({type: 'keyDown', key: 'Delete', code: 'Delete'});
  await Input.dispatchKeyEvent({type: 'keyUp',   key: 'Delete', code: 'Delete'});
  await sleep(300);

  // Chia prompt: gõ 15% đầu, paste 70% giữa, gõ 15% cuối (chống bot)
  const pasteLen      = Math.floor(promptText.length * 0.70);
  const typeFirstLen  = Math.floor((promptText.length - pasteLen) / 2);
  const typeFirst     = promptText.substring(0, typeFirstLen);
  const pasteMiddle   = promptText.substring(typeFirstLen, typeFirstLen + pasteLen);
  const typeLast      = promptText.substring(typeFirstLen + pasteLen);

  for (const ch of typeFirst) {
    await Input.dispatchKeyEvent({type: 'keyDown', text: ch});
    await Input.dispatchKeyEvent({type: 'keyUp',   text: ch});
    await sleep(Math.floor(Math.random() * 60) + 30);
  }
  if (pasteMiddle) await Input.insertText({ text: pasteMiddle });
  await sleep(300);
  for (const ch of typeLast) {
    await Input.dispatchKeyEvent({type: 'keyDown', text: ch});
    await Input.dispatchKeyEvent({type: 'keyUp',   text: ch});
    await sleep(Math.floor(Math.random() * 60) + 30);
  }
  await sleep(500);

  // Click Submit
  const { result: submitRes } = await Runtime.evaluate({
    expression: `
      (() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => !b.disabled && b.querySelector('i') && b.querySelector('i').textContent.trim() === 'arrow_forward');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
      })()
    `
  });
  if (!submitRes.value) throw new Error('Không tìm thấy nút Submit!');
  const submitPos = JSON.parse(submitRes.value);
  await clickAt(Input, submitPos.x, submitPos.y);

  log(`  ✓ Đã submit prompt`);
}

// ═══════════════════════════════════════════════════════════════
// BƯỚC 5: CHỜ KẾT QUẢ (2 PHASE)
// ═══════════════════════════════════════════════════════════════
async function waitForImages(Runtime, maxWaitSec) {
  log(`[5/6] Chờ 4 ảnh generation (tối đa ${maxWaitSec}s)...`);

  const stateExpr = `
    (() => {
      const isLoading = ['mat-progress-bar','mat-spinner','[role="progressbar"]',
        '[class*="shimmer"]','[class*="skeleton"]','[aria-busy="true"]'].some(s => {
        return Array.from(document.querySelectorAll(s)).some(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        });
      });
      const submitBtn = Array.from(document.querySelectorAll('button'))
        .find(b => { const i = b.querySelector('i'); return i && i.textContent.trim() === 'arrow_forward'; });
      const submitEnabled = submitBtn ? !submitBtn.disabled : false;
      const imageCount = Array.from(document.querySelectorAll('img')).filter(img => {
        const r = img.getBoundingClientRect();
        return r.width > 100 && r.height > 100 && img.src && img.src.length > 10;
      }).length;
      return JSON.stringify({ isLoading, submitEnabled, imageCount });
    })()
  `;

  // Phase 1: Chờ loading BẮT ĐẦU (tối đa 20s)
  log(`  → Phase 1: Chờ generation khởi động...`);
  const phase1End = Date.now() + 20000;
  let loadingDetected = false;

  while (Date.now() < phase1End) {
    await sleep(1500);
    const { result } = await Runtime.evaluate({ expression: stateExpr });
    if (!result?.value) continue;
    const d = JSON.parse(result.value);
    if (d.isLoading || !d.submitEnabled) {
      loadingDetected = true;
      log(`  ✓ Generation đã bắt đầu (loading=${d.isLoading}, submit=${d.submitEnabled})`);
      break;
    }
  }

  if (!loadingDetected) log(`  ⚠️ Không thấy loading trong 20s — có thể đã gen nhanh, tiếp tục...`);

  // Phase 2: Chờ loading KẾT THÚC + có ảnh
  log(`  → Phase 2: Chờ hoàn tất...`);
  const phase2End = Date.now() + maxWaitSec * 1000;
  let attempt = 0;

  while (Date.now() < phase2End) {
    attempt++;
    await sleep(3000);
    const { result } = await Runtime.evaluate({ expression: stateExpr });
    if (!result?.value) continue;
    const d = JSON.parse(result.value);
    log(`  → Lần ${attempt}: loading=${d.isLoading}, submitOK=${d.submitEnabled}, images=${d.imageCount}`);

    if (!d.isLoading && d.submitEnabled && d.imageCount >= 1) {
      log(`  ✓ Tạo xong ${d.imageCount} ảnh!`);
      return d.imageCount;
    }
  }

  throw new Error(`Timeout sau ${maxWaitSec}s — không nhận được ảnh!`);
}

// ═══════════════════════════════════════════════════════════════
// BƯỚC 6: TẢI 4 ẢNH VỀ MÁY
// ═══════════════════════════════════════════════════════════════
async function downloadImages(Runtime, Input, Page, outputFolder, prefix) {
  log(`[6/6] Tải ảnh về: ${outputFolder}`);
  if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

  await Page.setDownloadBehavior({ behavior: 'allow', downloadPath: outputFolder });
  const existingFiles = new Set(fs.readdirSync(outputFolder));

  // Hover vào result cards để hiện nút download
  const { result: cardsRes } = await Runtime.evaluate({
    expression: `
      (() => {
        const cards = [];
        const seen  = new Set();
        for (const img of Array.from(document.querySelectorAll('img')).filter(i => {
          const r = i.getBoundingClientRect(); return r.width > 100 && r.height > 100;
        })) {
          let node = img;
          for (let k = 0; k < 6; k++) {
            if (!node.parentElement) break;
            node = node.parentElement;
            const r = node.getBoundingClientRect();
            if (r.width > 100 && r.height > 100 && r.width < 1200) {
              const key = Math.round(r.x) + ',' + Math.round(r.y);
              if (!seen.has(key)) { seen.add(key); cards.push({x: r.left + r.width/2, y: r.top + r.height/2}); }
              break;
            }
          }
        }
        return JSON.stringify(cards);
      })()
    `
  });
  const cards = JSON.parse(cardsRes.value || '[]');
  log(`  → ${cards.length} result cards, hover để hiện nút download...`);
  for (const c of cards) {
    await Input.dispatchMouseEvent({type: 'mouseMoved', x: c.x, y: c.y});
    await sleep(600);
  }
  await sleep(800);

  // Tìm nút download
  const { result: btnsRes } = await Runtime.evaluate({
    expression: `
      (() => {
        return JSON.stringify(
          Array.from(document.querySelectorAll('button, a')).filter(b => {
            const icon  = b.querySelector('i');
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            const title = (b.getAttribute('title') || '').toLowerCase();
            if (icon && icon.textContent.trim().toLowerCase() === 'download') return true;
            if (label.includes('download') || label.includes('save')) return true;
            if (title.includes('download')) return true;
            return false;
          }).map(b => {
            const r = window.getComputedStyle(b);
            const rect = b.getBoundingClientRect();
            return { x: rect.left + rect.width/2, y: rect.top + rect.height/2,
                     visible: rect.width > 0 && r.display !== 'none' && r.visibility !== 'hidden' };
          }).filter(b => b.visible)
        );
      })()
    `
  });
  const btns = JSON.parse(btnsRes.value || '[]');
  log(`  → Tìm thấy ${btns.length} nút download`);

  const downloaded = [];

  if (btns.length > 0) {
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      await Input.dispatchMouseEvent({type: 'mouseMoved', x: b.x, y: b.y});
      await sleep(400);
      await clickAt(Input, b.x, b.y);

      // Chờ file mới (60s)
      const start = Date.now();
      let newFile = null;
      while (Date.now() - start < 60000) {
        await sleep(1000);
        const curr = fs.readdirSync(outputFolder);
        const nf   = curr.find(f => !existingFiles.has(f) && !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
        if (nf) { newFile = nf; break; }
      }

      if (newFile) {
        const ext      = path.extname(newFile);
        const newName  = `${prefix}_${String(i + 1).padStart(2, '0')}${ext}`;
        const oldPath  = path.join(outputFolder, newFile);
        const newFPath = path.join(outputFolder, newName);
        try { fs.renameSync(oldPath, newFPath); downloaded.push(newFPath); existingFiles.add(newName); }
        catch { downloaded.push(oldPath); existingFiles.add(newFile); }
        log(`  ✓ Đã lưu: ${newName}`);
      } else {
        log(`  ⚠️ Timeout tải ảnh ${i + 1}`);
      }

      await Input.dispatchMouseEvent({type: 'mouseMoved', x: 300, y: 300});
      await sleep(400);
    }
  }

  // Fallback base64 nếu không download được
  if (downloaded.length === 0) {
    log(`  → Fallback: trích xuất base64...`);
    const { result: b64Res } = await Runtime.evaluate({
      expression: `
        (async () => {
          const imgs = Array.from(document.querySelectorAll('img')).filter(i => {
            const r = i.getBoundingClientRect(); return r.width > 100 && r.height > 100 && i.src;
          });
          const out = [];
          for (const img of imgs) {
            try {
              const blob = await (await fetch(img.src)).blob();
              const b64  = await new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onloadend = () => res(fr.result);
                fr.onerror   = rej;
                fr.readAsDataURL(blob);
              });
              out.push({ b64, mime: blob.type });
            } catch(e) { out.push({ error: e.message }); }
          }
          return JSON.stringify(out);
        })()
      `,
      awaitPromise: true, timeout: 120000
    });
    const items = JSON.parse(b64Res.value || '[]');
    const mimes = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
    items.forEach((item, i) => {
      if (!item.b64) { log(`  ⚠️ Skip ${i+1}: ${item.error}`); return; }
      const ext  = mimes[item.mime] || '.jpg';
      const name = `${prefix}_${String(i+1).padStart(2,'0')}${ext}`;
      const fp   = path.join(outputFolder, name);
      fs.writeFileSync(fp, Buffer.from(item.b64.split(',')[1], 'base64'));
      downloaded.push(fp);
      log(`  ✓ Đã lưu (b64): ${name}`);
    });
  }

  return downloaded;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
(async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  TEST PHASE 1 — Tạo 4 ảnh từ ảnh gốc`);
  console.log(`${'═'.repeat(60)}`);

  // Validate đầu vào
  if (!IMAGE_PATH) {
    console.error('\n❌ Thiếu đường dẫn ảnh!');
    console.error('   Dùng: node test-phase1.js <image_path> <product> [context] [output_folder]\n');
    process.exit(1);
  }
  const absImagePath = path.resolve(IMAGE_PATH);
  if (!fs.existsSync(absImagePath)) {
    console.error(`\n❌ File không tồn tại: ${absImagePath}\n`);
    process.exit(1);
  }

  log(`Ảnh gốc  : ${absImagePath}`);
  log(`Product  : ${PRODUCT}`);
  log(`Context  : ${CONTEXT || '(không có)'}`);
  log(`Output   : ${OUTPUT_FOLDER}`);
  log(`Max wait : ${MAX_WAIT_SEC}s`);
  console.log(`${'─'.repeat(60)}`);

  let client;
  const startTime = Date.now();

  try {
    // 1. Lấy prompt (không cần CDP)
    const promptText = await getPrompt(PRODUCT, CONTEXT);

    // Kết nối CDP một lần duy nhất cho tất cả các bước còn lại
    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google! Hãy mở Chrome với --remote-debugging-port=9222');

    client = await CDP({target: flowTab.id, port: 9222});
    const { Runtime, Input, Page, DOM } = client;
    await Runtime.enable();
    await Page.enable();
    await DOM.enable();

    // 2. Setup mode ảnh x4
    await setupImageMode(Runtime, Input);

    // 3. Upload ảnh gốc
    await uploadImage(Runtime, Input, Page, DOM, absImagePath);

    // 4. Nhập prompt & submit
    await inputPromptAndSubmit(Runtime, Input, promptText);

    // 5. Chờ kết quả
    const imgCount = await waitForImages(Runtime, MAX_WAIT_SEC);

    // 6. Tải ảnh về
    const taskPrefix = path.basename(absImagePath, path.extname(absImagePath));
    const files = await downloadImages(Runtime, Input, Page, OUTPUT_FOLDER, taskPrefix + '_img');

    // Tổng kết
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ✅ PHASE 1 HOÀN TẤT (${elapsed}s)`);
    console.log(`  → Generation: ${imgCount} ảnh`);
    console.log(`  → Đã tải   : ${files.length} file`);
    files.forEach(f => console.log(`     • ${path.basename(f)}`));
    console.log(`  → Thư mục  : ${OUTPUT_FOLDER}`);
    console.log(`${'═'.repeat(60)}\n`);

    console.log(JSON.stringify({ success: true, files, count: files.length }));

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n${'═'.repeat(60)}`);
    console.error(`  ❌ PHASE 1 THẤT BẠI (${elapsed}s)`);
    console.error(`  Lỗi: ${err.message}`);
    console.error(`${'═'.repeat(60)}\n`);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
