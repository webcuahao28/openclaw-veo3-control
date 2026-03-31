#!/usr/bin/env node
/**
 * veo3-full.js  —  Phase 1 (Tạo 4 ảnh) + Phase 2 (Tạo 16 video)
 * ─────────────────────────────────────────────────────────────────────────────
 * [PHASE 1]
 *   1. Lấy prompt ảnh từ Google Sheet
 *   2. Setup mode ảnh x4
 *   3. Upload ảnh gốc
 *   4. Nhập prompt & Submit
 *   5. Chờ 4 ảnh → capture UUIDs
 *   6. Sleep ngẫu nhiên 25–35s
 *
 * [PHASE 2]  vòng i=0: setup video + chọn frame + nhập prompt + submit
 *            vòng i>0: bỏ chọn frame cũ + chọn frame mới + submitOnly (tái dùng prompt)
 *   → Stall detection: nếu đang có video mới nhưng không tăng thêm 30s → tiếp tục
 *   → Cuối: Xoá câu lệnh
 *
 * Cú pháp:
 *   node veo3-full.js "<image_path>" <product> [context]
 *
 * Ví dụ:
 *   node veo3-full.js "G:\Tasks\hat\cap1.jpg" hat instore
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CDP  = require('chrome-remote-interface');
const path = require('path');
const fs   = require('fs');

// ── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// ═══════════════════════════════════════════════════════════════
// THAM SỐ ĐẦU VÀO
// ═══════════════════════════════════════════════════════════════
const IMAGE_PATH = process.argv[2];
const PRODUCT    = process.argv[3] || 'product';
const CONTEXT    = process.argv[4] || '';

const OUTPUT_ROOT = IMAGE_PATH
  ? path.join(path.dirname(path.resolve(IMAGE_PATH)), 'output')
  : path.join(process.cwd(), 'output');

const WEBHOOK_URL = process.env.WEBHOOK_URL ||
  'https://script.google.com/macros/s/AKfycbzxYh83welrm_o-p5j5GNy5nAm0QsFHVMFvmgjN-PsfZjevLEWw0A9FLqS9WslHyh3j_Q/exec';

const randImgWait = () => Math.floor(Math.random() * 61) + 240; // 240–300s
const randVidWait = () => Math.floor(Math.random() * 61) + 360; // 360–420s
const randSleep   = () => Math.floor(Math.random() * 11) + 10;  // 10–20s
const randSleepP1 = () => Math.floor(Math.random() * 11) + 25;  // 25–35s

// ═══════════════════════════════════════════════════════════════
// TIỆN ÍCH
// ═══════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const ts = new Date().toTimeString().split(' ')[0];
  console.log(`[${ts}] ${msg}`);
}

async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({ type: 'mouseMoved',    x, y });
  await sleep(100);
  await Input.dispatchMouseEvent({ type: 'mousePressed',  x, y, button: 'left', clickCount: 1 });
  await sleep(100);
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function waitForExpr(Runtime, expression, maxRetries = 15, delayMs = 600) {
  for (let i = 0; i < maxRetries; i++) {
    const { result } = await Runtime.evaluate({ expression });
    if (result && result.value) return JSON.parse(result.value);
    await sleep(delayMs);
  }
  return null;
}

function makeVideoFolder(outputRoot, imgIndex, product, context, imageBaseName) {
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const ctx     = context && context.trim() ? context.trim() : 'nocontext';
  const base    = `[${imgIndex}] - ${product} - ${ctx} - ${dateStr} - ${imageBaseName}`;
  let candidate = path.join(outputRoot, base);
  let suffix    = 1;
  while (fs.existsSync(candidate)) {
    suffix++;
    candidate = path.join(outputRoot, `${base}_${suffix}`);
  }
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

// ═══════════════════════════════════════════════════════════════
// LẤY PROMPT TỪ GOOGLE SHEET
// ═══════════════════════════════════════════════════════════════
async function getPrompt(product, context, mode = 'image') {
  log(`  → Lấy prompt [${mode.toUpperCase()}] product="${product}" context="${context || 'none'}"`);
  const url = new URL(WEBHOOK_URL);
  url.searchParams.append('mode', mode.trim());
  url.searchParams.append('product', product.trim());
  if (context && context.trim()) url.searchParams.append('context', context.trim());
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url.toString(), { signal: controller.signal });
  clearTimeout(tid);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Google Sheet trả về lỗi');
  log(`  ✓ Prompt: "${data.prompt.substring(0, 80)}..."`);
  return data.prompt;
}

// ═══════════════════════════════════════════════════════════════
// SETUP MODE
// ═══════════════════════════════════════════════════════════════
async function setupMode(Runtime, Input, mode, qty = 'x4') {
  log(`  → Setup mode: ${mode.toUpperCase()} ${qty}`);

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

  const modeSelector = mode === 'video'
    ? `b.textContent.toLowerCase().includes('video')`
    : `(b.textContent.toLowerCase().includes('hình') || b.textContent.toLowerCase().includes('image'))`;

  const modeTabPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button[role="tab"]'))
        .find(b => ${modeSelector});
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `, 5, 500);
  if (!modeTabPos) { await clickAt(Input, 10, 10); throw new Error(`Không tìm thấy tab ${mode}!`); }

  await clickAt(Input, modeTabPos.x, modeTabPos.y);
  await sleep(800);

  const qtyLower = qty.toLowerCase();
  const qtyPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button[role="tab"]'))
        .find(b => b.textContent.trim().toLowerCase() === '${qtyLower}');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()
  `, 5, 500);
  if (!qtyPos) { await clickAt(Input, 10, 10); throw new Error(`Không tìm thấy nút ${qty}!`); }

  await clickAt(Input, qtyPos.x, qtyPos.y);
  await sleep(500);
  await clickAt(Input, 10, 10);
  await sleep(500);
  log(`  ✓ Đã setup ${mode.toUpperCase()} ${qty}`);
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD ẢNH GỐC
// ═══════════════════════════════════════════════════════════════
async function uploadImage(Runtime, Input, Page, DOM, Network, imagePath) {
  log(`[3/5] Upload ảnh: ${path.basename(imagePath)}`);

  let uploadSignal = false;
  Network.requestWillBeSent(({ request }) => {
    if (!request.url.includes('batchLogFrontendEvents')) return;
    try {
      const body = JSON.parse(request.postData || '{}');
      if (body.events?.some(e => e.eventType === 'FLOW_UPLOAD')) {
        uploadSignal = true;
        log(`  ✓ FLOW_UPLOAD signal nhận được`);
      }
    } catch {}
  });

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
  await sleep(1500);

  await Page.setInterceptFileChooserDialog({ enabled: true });
  let fileChosen = false;

  Page.fileChooserOpened(async ({ backendNodeId }) => {
    try {
      await DOM.setFileInputFiles({ files: [imagePath], backendNodeId });
      fileChosen = true;
      log(`  ✓ File đã được set vào input`);
    } catch (e) {
      log(`  ⚠️ setFileInputFiles error: ${e.message}`);
    }
  });

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
  for (let i = 0; i < 16 && !fileChosen; i++) await sleep(500);
  await Page.setInterceptFileChooserDialog({ enabled: false });

  if (!fileChosen) { await clickAt(Input, 10, 10); throw new Error('File chooser timeout!'); }

  log(`  → Chờ FLOW_UPLOAD signal...`);
  for (let i = 0; i < 30 && !uploadSignal; i++) await sleep(1000);
  if (!uploadSignal) log(`  ⚠️ Không nhận FLOW_UPLOAD signal sau 30s, thử tiếp...`);

  const { result: dlgCheck } = await Runtime.evaluate({
    expression: `document.querySelector('[role="dialog"]') ? 'open' : 'closed'`
  });
  if (dlgCheck.value === 'open') { await clickAt(Input, 10, 10); await sleep(500); }
  log(`  ✓ Upload hoàn tất`);
}

// ═══════════════════════════════════════════════════════════════
// NHẬP PROMPT & SUBMIT
// ═══════════════════════════════════════════════════════════════
async function inputPromptAndSubmit(Runtime, Input, promptText) {
  log(`  → Nhập prompt & submit (${promptText.length} ký tự)`);

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
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        const r = el.getBoundingClientRect();
        const clickY = r.height < 30 ? r.top + r.height / 2 : r.top + r.height * 0.5;
        return JSON.stringify({x: r.left + r.width / 2, y: clickY, h: r.height});
      })()
    `
  });
  if (!editorRes.value) throw new Error('Không tìm thấy ô nhập liệu!');
  const editorPos = JSON.parse(editorRes.value);
  log(`  → Editor tại (${Math.round(editorPos.x)}, ${Math.round(editorPos.y)}) h=${Math.round(editorPos.h)}`);

  await sleep(300);
  await clickAt(Input, editorPos.x, editorPos.y);
  await sleep(400);
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 0 });
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'a',       code: 'KeyA',        modifiers: 8 });
  await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'a',       code: 'KeyA',        modifiers: 8 });
  await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Control', code: 'ControlLeft', modifiers: 0 });
  await sleep(200);
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Delete', code: 'Delete' });
  await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Delete', code: 'Delete' });
  await sleep(300);

  const pasteLen     = Math.floor(promptText.length * 0.70);
  const typeFirstLen = Math.floor((promptText.length - pasteLen) / 2);
  const typeFirst    = promptText.substring(0, typeFirstLen);
  const pasteMiddle  = promptText.substring(typeFirstLen, typeFirstLen + pasteLen);
  const typeLast     = promptText.substring(typeFirstLen + pasteLen);

  for (const ch of typeFirst) {
    await Input.dispatchKeyEvent({ type: 'keyDown', text: ch });
    await Input.dispatchKeyEvent({ type: 'keyUp',   text: ch });
    await sleep(Math.floor(Math.random() * 60) + 30);
  }
  if (pasteMiddle) await Input.insertText({ text: pasteMiddle });
  await sleep(300);
  for (const ch of typeLast) {
    await Input.dispatchKeyEvent({ type: 'keyDown', text: ch });
    await Input.dispatchKeyEvent({ type: 'keyUp',   text: ch });
    await sleep(Math.floor(Math.random() * 60) + 30);
  }
  await sleep(500);

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
  await clickAt(Input, ...Object.values(JSON.parse(submitRes.value)));
  log(`  ✓ Đã submit`);
}

// ═══════════════════════════════════════════════════════════════
// CHỜ ẢNH → RETURN UUIDs
// ═══════════════════════════════════════════════════════════════
async function waitForImages(Runtime) {
  const maxWaitSec = randImgWait();
  log(`[5/5] Chờ 4 ảnh generation (tối đa ${maxWaitSec}s)...`);

  const stateExpr = `
    (() => {
      const isLoading = ['mat-progress-bar','mat-spinner','[role="progressbar"]',
        '[class*="shimmer"]','[class*="skeleton"]','[aria-busy="true"]'].some(s =>
        Array.from(document.querySelectorAll(s)).some(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        })
      );
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

  const p1End = Date.now() + 20000;
  let loadingDetected = false;
  while (Date.now() < p1End) {
    await sleep(1500);
    const { result } = await Runtime.evaluate({ expression: stateExpr });
    if (!result?.value) continue;
    const d = JSON.parse(result.value);
    if (d.isLoading || !d.submitEnabled) { loadingDetected = true; break; }
  }
  if (!loadingDetected) log(`  ⚠️ Không thấy loading — tiếp tục...`);

  const p2End = Date.now() + maxWaitSec * 1000;
  let attempt = 0;
  while (Date.now() < p2End) {
    attempt++;
    await sleep(3000);
    const { result } = await Runtime.evaluate({ expression: stateExpr });
    if (!result?.value) continue;
    const d = JSON.parse(result.value);
    log(`  → Lần ${attempt}: loading=${d.isLoading}, submitOK=${d.submitEnabled}, images=${d.imageCount}`);
    if (!d.isLoading && d.submitEnabled && d.imageCount >= 1) {
      log(`  ✓ Tạo xong ${d.imageCount} ảnh! Đang capture UUIDs...`);
      break;
    }
  }

  const { result: uuidRes } = await Runtime.evaluate({
    expression: `
      (() => {
        const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
          const r = img.getBoundingClientRect();
          return r.width > 150 && r.height > 150
            && img.src.includes('getMediaUrlRedirect')
            && !img.closest('[role="dialog"]');
        });
        const uuids = [];
        for (const img of imgs) {
          const m = img.src.match(/name=([^&]+)/);
          if (m && m[1] && !uuids.includes(m[1])) uuids.push(m[1]);
          if (uuids.length >= 4) break;
        }
        return JSON.stringify(uuids);
      })()
    `
  });

  const uuids = JSON.parse(uuidRes.value || '[]');
  log(`  ✓ Captured ${uuids.length} UUID(s)`);
  if (uuids.length === 0) throw new Error('Không capture được UUID nào từ ảnh đã gen!');
  return uuids;
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT VIDEO UUIDs HIỆN CÓ (gọi TRƯỚC submit)
// ═══════════════════════════════════════════════════════════════
async function snapshotVideoUUIDs(Runtime) {
  const { result } = await Runtime.evaluate({
    expression: `JSON.stringify(
      (() => {
        const seen = new Set();
        for (const v of Array.from(document.querySelectorAll('video'))) {
          const src = v.getAttribute('src') || v.src || '';
          const m = src.match(/name=([^&]+)/);
          if (m && m[1]) seen.add(m[1]);
        }
        return [...seen];
      })()
    )`
  });
  const uuids = JSON.parse(result.value || '[]');
  log(`  → Snapshot ${uuids.length} video UUIDs hiện có`);
  return new Set(uuids);
}

// ═══════════════════════════════════════════════════════════════
// SELECT START FRAME — Sort "Mới nhất" → click theo position index
// ═══════════════════════════════════════════════════════════════
async function selectStartFrameByPosition(Runtime, Input, positionIndex) {
  log(`  → Select start frame: vị trí ${positionIndex} (sort Mới nhất)`);

  const startBtnPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('div[type="button"], button, div[role="button"]'))
        .find(el => { const t = (el.textContent || '').trim(); return t === 'Bắt đầu' || t === 'Start'; });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()
  `, 10, 600);
  if (!startBtnPos) throw new Error('Không tìm thấy nút "Bắt đầu"!');

  await clickAt(Input, startBtnPos.x, startBtnPos.y);
  await sleep(1500);

  const popupReady = await waitForExpr(Runtime, `
    (() => {
      const btn = document.querySelector('.SortDropdownSubTrigger');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return r.width > 0 ? JSON.stringify({ found: true }) : null;
    })()
  `, 8, 500);
  if (!popupReady) throw new Error('Library popup không mở!');
  log(`  ✓ Dialog đã mở`);

  const sortBtnPos = await waitForExpr(Runtime, `
    (() => {
      const btn = document.querySelector('.SortDropdownSubTrigger');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()
  `, 5, 400);

  if (sortBtnPos) {
    await clickAt(Input, sortBtnPos.x, sortBtnPos.y);
    await sleep(800);
    const newestPos = await waitForExpr(Runtime, `
      (() => {
        const items = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"]'));
        const item = items.find(el => {
          const t = el.textContent.toLowerCase();
          return t.includes('mới nhất') || t.includes('newest');
        });
        if (!item) return null;
        const r = item.getBoundingClientRect();
        if (r.width === 0) return null;
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()
    `, 5, 400);
    if (newestPos) {
      await clickAt(Input, newestPos.x, newestPos.y);
      await sleep(800);
      log(`  ✓ Đã sort Mới nhất`);
    } else {
      log(`  ⚠️ Không thấy item Mới nhất`);
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape' });
      await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Escape', code: 'Escape' });
      await sleep(300);
    }
  } else {
    log(`  ⚠️ Không thấy nút Sort`);
  }

  await Runtime.evaluate({ expression: `
    (() => {
      const btn = document.querySelector('.SortDropdownSubTrigger');
      if (!btn) return;
      let node = btn;
      for (let i = 0; i < 10; i++) {
        if (!node.parentElement) break;
        node = node.parentElement;
        const s = node.querySelector('[data-virtuoso-scroller="true"]');
        if (s) { s.scrollTop = 0; return; }
      }
    })()
  ` });
  await sleep(600);

  const clicked = await waitForExpr(Runtime,
    '(() => {' +
    '  const sel = \'[data-item-index="' + positionIndex + '"]\';' +
    '  const dialog = document.querySelector(\'[role="dialog"]\');' +
    '  if (!dialog) return null;' +
    '  const wrapper = dialog.querySelector(sel);' +
    '  if (!wrapper) return null;' +
    '  const img = wrapper.querySelector(\'img\');' +
    '  if (!img) return null;' +
    '  img.scrollIntoView({ behavior: "instant", block: "nearest" });' +
    '  const r = img.getBoundingClientRect();' +
    '  if (r.width === 0 || r.height === 0) return null;' +
    '  img.click();' +
    '  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });' +
    '})()',
  10, 500);

  if (!clicked) throw new Error(`Không tìm thấy img tại item ${positionIndex}!`);
  log(`  → img.click() tại (${clicked.x}, ${clicked.y})`);
  await sleep(1500);

  const { result: popupCheck } = await Runtime.evaluate({
    expression: `document.querySelector('.SortDropdownSubTrigger') ? 'open' : 'closed'`
  });
  if (popupCheck.value === 'open') {
    log(`  ⚠️ Popup vẫn mở, thử CDP click...`);
    await clickAt(Input, clicked.x, clicked.y);
    await sleep(1000);
    const { result: check2 } = await Runtime.evaluate({
      expression: `document.querySelector('.SortDropdownSubTrigger') ? 'open' : 'closed'`
    });
    if (check2.value === 'open') {
      log(`  ⚠️ Vẫn mở, Escape...`);
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape' });
      await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Escape', code: 'Escape' });
      await sleep(500);
    }
  }
  log(`  ✓ Start frame đã chọn (vị trí ${positionIndex})`);
}

// ═══════════════════════════════════════════════════════════════
// BỎ CHỌN START FRAME HIỆN TẠI (dùng từ vòng i>0 Phase 2)
// ═══════════════════════════════════════════════════════════════
async function deselectStartFrame(Runtime, Input) {
  log(`  → Bỏ chọn start frame hiện tại...`);

  const cancelPos = await waitForExpr(Runtime, `
    (() => {
      const icon = Array.from(document.querySelectorAll('i'))
        .find(i => i.textContent.trim() === 'cancel' && i.closest('[class*="sc-df80b1f8-4"]'));
      if (!icon) return null;
      const btn = icon.closest('div');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()
  `, 8, 400);

  if (!cancelPos) {
    log(`  ⚠️ Không tìm thấy nút cancel start frame — bỏ qua`);
    return false;
  }

  await clickAt(Input, cancelPos.x, cancelPos.y);
  await sleep(800);

  const { result: check } = await Runtime.evaluate({
    expression: `
      (() => {
        const icon = Array.from(document.querySelectorAll('i'))
          .find(i => i.textContent.trim() === 'cancel' && i.closest('[class*="sc-df80b1f8-4"]'));
        return icon ? 'still_selected' : 'deselected';
      })()
    `
  });
  if (check.value === 'deselected') {
    log(`  ✓ Đã bỏ chọn start frame`);
    return true;
  } else {
    log(`  ⚠️ Vẫn còn thumbnail, thử click lại...`);
    await clickAt(Input, cancelPos.x, cancelPos.y);
    await sleep(800);
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════
// SUBMIT ONLY — tái dùng prompt hiện có (không nhập lại)
// ═══════════════════════════════════════════════════════════════
async function submitOnly(Runtime, Input) {
  log(`  → Submit (tái dùng prompt hiện có)...`);

  const submitPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => !b.disabled && b.querySelector('i') && b.querySelector('i').textContent.trim() === 'arrow_forward');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()
  `, 8, 500);

  if (!submitPos) throw new Error('Không tìm thấy nút Submit!');
  await clickAt(Input, submitPos.x, submitPos.y);
  log(`  ✓ Đã submit`);
}

// ═══════════════════════════════════════════════════════════════
// CHỜ VIDEO GENERATION — PATCH signal + DOM polling + stall detection
// ═══════════════════════════════════════════════════════════════
async function waitForVideos(Network, Runtime, existingVideoUUIDs = new Set()) {
  const EXPECTED      = 4;
  const MAX_WAIT_MS   = randVidWait() * 1000;
  const DONE_SLEEP_MS = randSleep() * 1000;
  const POLL_INTERVAL = 5000;
  const STALL_MS      = 30000;

  log(`  → Chờ ${EXPECTED} video mới (PATCH + DOM poll, tối đa ${Math.round(MAX_WAIT_MS/1000)}s)...`);

  return new Promise((resolve) => {
    let patchCount   = 0;
    let settled      = false;
    let lastCount    = 0;
    let lastChangeAt = Date.now();

    function done(reason, detail = '') {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      clearInterval(pollId);
      if (reason === 'timeout') {
        log(`  ⚠️ Timeout — patchCount=${patchCount}, tiếp tục...`);
        resolve(patchCount);
      } else {
        log(`  ✓ ${detail}. Sleep ${Math.round(DONE_SLEEP_MS/1000)}s...`);
        sleep(DONE_SLEEP_MS).then(() => resolve(patchCount));
      }
    }

    // PATCH listener
    Network.requestWillBeSent(({ request }) => {
      if (settled) return;
      if (
        request.method === 'PATCH' &&
        request.url.includes('aisandbox-pa.googleapis.com') &&
        request.url.includes('/v1/flowWorkflows/')
      ) {
        patchCount++;
        log(`  → PATCH #${patchCount}/${EXPECTED}: ${request.url.split('/').pop().substring(0, 8)}...`);
        if (patchCount >= EXPECTED) done('complete', `Đủ ${EXPECTED} PATCH`);
      }
    });

    // DOM polling + stall detection
    const existingArr = [...existingVideoUUIDs];
    const pollId = setInterval(async () => {
      if (settled) return;
      try {
        const { result } = await Runtime.evaluate({
          expression: `
            (() => {
              const existing = ${JSON.stringify(existingArr)};
              const seen = new Set();
              for (const v of document.querySelectorAll('video')) {
                const src = v.getAttribute('src') || '';
                const m = src.match(/name=([^&]+)/);
                if (m && m[1] && !existing.includes(m[1])) seen.add(m[1]);
              }
              return JSON.stringify([...seen]);
            })()
          `
        });
        const newUUIDs = JSON.parse(result.value || '[]');
        const count = newUUIDs.length;

        if (count > lastCount) {
          lastCount    = count;
          lastChangeAt = Date.now();
          log(`  → DOM poll: ${count}/${EXPECTED} UUID mới`);
        }

        if (count >= EXPECTED) {
          done('complete', `DOM poll thấy đủ ${EXPECTED} UUID mới`);
          return;
        }

        // Stall detection: có video mới nhưng không tăng thêm quá STALL_MS
        if (count > 0 && Date.now() - lastChangeAt >= STALL_MS) {
          log(`  ⚠️ Stall ${STALL_MS/1000}s — chỉ ${count}/${EXPECTED} UUID. Tiến hành với ${count} video...`);
          done('complete', `Stall detected`);
        }
      } catch (_) { /* ignore poll errors */ }
    }, POLL_INTERVAL);

    const tid = setTimeout(() => done('timeout'), MAX_WAIT_MS);
  });
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD VIDEO — UUID-based (bỏ qua video cũ)
// ═══════════════════════════════════════════════════════════════
async function downloadVideos(Runtime, Input, Page, outputFolder, existingVideoUUIDs = new Set()) {
  log(`  → Download video → ${path.basename(outputFolder)}`);

  await Page.setDownloadBehavior({ behavior: 'allow', downloadPath: outputFolder });
  const existingFiles = new Set(fs.readdirSync(outputFolder));

  await Runtime.evaluate({ expression: `window.scrollTo(0, 0)` });
  await sleep(800);

  // Hover vào card MỚI để trigger download button
  const { result: cardsRes } = await Runtime.evaluate({
    expression: `
      (() => {
        const existingUUIDs = ${JSON.stringify([...existingVideoUUIDs])};
        const cards = [], seen = new Set();
        for (const vid of Array.from(document.querySelectorAll('video'))) {
          const src = vid.getAttribute('src') || vid.src || '';
          const m = src.match(/name=([^&]+)/);
          if (!m || existingUUIDs.includes(m[1])) continue;
          let node = vid;
          for (let k = 0; k < 6; k++) {
            if (!node.parentElement) break;
            node = node.parentElement;
            const r = node.getBoundingClientRect();
            if (r.width > 50 && r.height > 50 && r.width < 1200) {
              const key = Math.round(r.x) + ',' + Math.round(r.y);
              if (!seen.has(key)) {
                seen.add(key);
                cards.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
              }
              break;
            }
          }
        }
        return JSON.stringify(cards);
      })()
    `
  });
  const cards = JSON.parse(cardsRes.value || '[]');
  log(`  → ${cards.length} video card mới, hover...`);
  for (const c of cards) {
    await Input.dispatchMouseEvent({ type: 'mouseMoved', x: c.x, y: c.y });
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
            const style = window.getComputedStyle(b);
            const rect  = b.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
              visible: rect.width > 0 && style.display !== 'none' && style.visibility !== 'hidden'
            };
          }).filter(b => b.visible)
        );
      })()
    `
  });
  const btns = JSON.parse(btnsRes.value || '[]');
  log(`  → ${btns.length} nút download`);

  const downloaded = [];

  if (btns.length > 0) {
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      await Input.dispatchMouseEvent({ type: 'mouseMoved', x: b.x, y: b.y });
      await sleep(400);
      await clickAt(Input, b.x, b.y);

      const start = Date.now();
      let newFile = null;
      while (Date.now() - start < 60000) {
        await sleep(1000);
        const curr = fs.readdirSync(outputFolder);
        const nf = curr.find(f =>
          !existingFiles.has(f) && !f.endsWith('.crdownload') &&
          !f.endsWith('.tmp') && !f.startsWith('.')
        );
        if (nf) { newFile = nf; break; }
      }

      if (newFile) {
        const ext     = path.extname(newFile);
        const newName = `video_${String(i + 1).padStart(2, '0')}${ext}`;
        const oldPath = path.join(outputFolder, newFile);
        let   newPath = path.join(outputFolder, newName);
        try { fs.renameSync(oldPath, newPath); existingFiles.add(newName); }
        catch { newPath = oldPath; existingFiles.add(newFile); }
        downloaded.push(newPath);
        log(`  ✓ Đã lưu: ${path.basename(newPath)}`);
      } else {
        log(`  ⚠️ Timeout tải video ${i + 1}`);
      }

      await Input.dispatchMouseEvent({ type: 'mouseMoved', x: 300, y: 300 });
      await sleep(400);
    }
  }

  // Fallback base64 — UUID-based, không cần bounding rect
  if (downloaded.length === 0) {
    log(`  → Fallback: base64 UUID-based...`);
    const { result: b64Res } = await Runtime.evaluate({
      expression: `
        (async () => {
          const existingUUIDs = ${JSON.stringify([...existingVideoUUIDs])};
          const seenUUIDs = new Set();
          const newVids = [];
          for (const v of Array.from(document.querySelectorAll('video'))) {
            const src = v.getAttribute('src') || v.src || '';
            const m = src.match(/name=([^&]+)/);
            if (!m || !m[1]) continue;
            const uuid = m[1];
            if (existingUUIDs.includes(uuid) || seenUUIDs.has(uuid)) continue;
            seenUUIDs.add(uuid);
            newVids.push({ uuid, src });
          }
          console.log('[fallback] newVids count:', newVids.length);
          const out = [];
          for (const item of newVids) {
            try {
              const fetchUrl = item.src.startsWith('http')
                ? item.src
                : (location.origin + (item.src.startsWith('/') ? '' : '/') + item.src);
              const resp = await fetch(fetchUrl);
              if (!resp.ok) throw new Error('HTTP ' + resp.status);
              const blob = await resp.blob();
              const b64  = await new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onloadend = () => res(fr.result);
                fr.onerror   = rej;
                fr.readAsDataURL(blob);
              });
              out.push({ b64, mime: blob.type, uuid: item.uuid });
            } catch(e) {
              out.push({ error: e.message, uuid: item.uuid });
            }
          }
          return JSON.stringify(out);
        })()
      `,
      awaitPromise: true, timeout: 120000
    });

    const items = JSON.parse(b64Res.value || '[]');
    log(`  → Fallback tìm thấy ${items.length} video mới`);
    const mimes = { 'video/mp4': '.mp4', 'video/webm': '.webm' };
    items.forEach((item, i) => {
      if (!item.b64) {
        log(`  ⚠️ Skip video ${i + 1} (uuid=${item.uuid?.substring(0,8)}): ${item.error}`);
        return;
      }
      const ext  = mimes[item.mime] || '.mp4';
      const name = `video_${String(i + 1).padStart(2, '0')}${ext}`;
      const fp   = path.join(outputFolder, name);
      fs.writeFileSync(fp, Buffer.from(item.b64.split(',')[1], 'base64'));
      downloaded.push(fp);
      log(`  ✓ Đã lưu (b64): ${name} [${item.uuid?.substring(0, 8)}...]`);
    });
  }

  return downloaded;
}

// ═══════════════════════════════════════════════════════════════
// XOÁ CÂU LỆNH SAU KHI HOÀN TẤT
// ═══════════════════════════════════════════════════════════════
async function clearPrompt(Runtime, Input) {
  log(`  → Xoá câu lệnh...`);
  const clearBtnPos = await waitForExpr(Runtime, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.querySelector('i') && b.querySelector('i').textContent.trim() === 'close'
          && (b.querySelector('span') || b).textContent.includes('Xoá câu lệnh'));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()
  `, 5, 400);
  if (clearBtnPos) {
    await clickAt(Input, clearBtnPos.x, clearBtnPos.y);
    await sleep(500);
    log(`  ✓ Đã xoá câu lệnh`);
  } else {
    log(`  ⚠️ Không tìm thấy nút Xoá câu lệnh`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
(async function main() {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  VEO3 FULL — Phase 1 (4 ảnh) + Phase 2 (16 video)`);
  console.log(`${'═'.repeat(65)}`);

  if (!IMAGE_PATH) {
    console.error('\n❌ Thiếu đường dẫn ảnh!');
    console.error('   Cú pháp: node veo3-full.js "<image_path>" <product> [context]\n');
    process.exit(1);
  }
  const absImagePath = path.resolve(IMAGE_PATH);
  if (!fs.existsSync(absImagePath)) {
    console.error(`\n❌ File không tồn tại: ${absImagePath}\n`);
    process.exit(1);
  }

  const imageBaseName = path.basename(absImagePath, path.extname(absImagePath));
  if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  log(`Ảnh gốc  : ${absImagePath}`);
  log(`Product  : ${PRODUCT}`);
  log(`Context  : ${CONTEXT || '(không có)'}`);
  log(`Output   : ${OUTPUT_ROOT}`);
  log(`ImgWait  : random 240–300s`);
  log(`VidWait  : random 360–420s | Stall: 30s`);
  log(`SleepP1  : random 25–35s`);
  log(`SleepP2  : random 10–20s`);
  console.log(`${'─'.repeat(65)}`);

  let client;
  const startTime = Date.now();
  const allVideos  = [];

  try {
    // ───────────────────────────────────────────────────────────
    // PHASE 1: TẠO 4 ẢNH
    // ───────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(65)}`);
    log(`[PHASE 1] TẠO 4 ẢNH`);
    console.log(`${'─'.repeat(65)}`);

    log(`[1/5] Lấy prompt ảnh...`);
    const imgPrompt = await getPrompt(PRODUCT, CONTEXT, 'image');

    const targets = await CDP.List({ port: 9222 });
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google! Mở Chrome với --remote-debugging-port=9222');

    client = await CDP({ target: flowTab.id, port: 9222 });
    const { Runtime, Input, Page, DOM, Network } = client;
    await Runtime.enable();
    await Page.enable();
    await DOM.enable();
    await Network.enable();

    log(`[2/5] Setup mode ảnh x4`);
    await setupMode(Runtime, Input, 'image', 'x4');

    await uploadImage(Runtime, Input, Page, DOM, Network, absImagePath);

    log(`[4/5] Nhập prompt ảnh & submit`);
    await inputPromptAndSubmit(Runtime, Input, imgPrompt);

    const imageUUIDs = await waitForImages(Runtime);
    const imageCount = imageUUIDs.length;
    log(`  ✓ ${imageCount} UUIDs captured`);

    await clearPrompt(Runtime, Input);

    const ws1 = randSleepP1();
    log(`  → Chờ ${ws1}s trước Phase 2...`);
    await sleep(ws1 * 1000);

    // ───────────────────────────────────────────────────────────
    // PHASE 2: TẠO VIDEO TỪ TỪNG ẢNH
    // Vòng 0   : setup video + chọn frame + nhập prompt + submit
    // Vòng 1..N: deselect + chọn frame + submitOnly (tái dùng prompt)
    // ───────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(65)}`);
    log(`[PHASE 2] TẠO ${imageCount} × 4 VIDEO = ${imageCount * 4} VIDEO`);
    console.log(`${'─'.repeat(65)}`);

    for (let i = 0; i < imageCount; i++) {
      console.log(`\n${'·'.repeat(55)}`);
      log(`[Phase2 ${i + 1}/${imageCount}] Ảnh thứ ${i + 1} (vị trí ${i} trong popup)`);

      const vidFolder = makeVideoFolder(OUTPUT_ROOT, i + 1, PRODUCT, CONTEXT, imageBaseName);
      log(`  → Thư mục: ${path.basename(vidFolder)}`);

      if (i === 0) {
        // ── VÒNG ĐẦU: setup + nhập prompt đầy đủ ─────────────
        log(`  Bước 1/4 → Setup video x4`);
        await setupMode(Runtime, Input, 'video', 'x4');

        const existingVideoUUIDs = await snapshotVideoUUIDs(Runtime);

        log(`  Bước 2/4 → Select start frame vị trí 0`);
        await selectStartFrameByPosition(Runtime, Input, 0);

        log(`  Bước 3/4 → Lấy prompt video`);
        const vidPrompt = await getPrompt(PRODUCT, CONTEXT, 'video');

        log(`  Bước 4/4 → Nhập prompt & submit`);
        await inputPromptAndSubmit(Runtime, Input, vidPrompt);

        await waitForVideos(Network, Runtime, existingVideoUUIDs);

        const vidFiles = await downloadVideos(Runtime, Input, Page, vidFolder, existingVideoUUIDs);
        allVideos.push(...vidFiles);
        log(`  ✓ ${vidFiles.length} video → ${path.basename(vidFolder)}`);

      } else {
        // ── VÒNG SAU: tái dùng prompt, chỉ đổi start frame ───
        const ws = randSleep();
        log(`  → Chờ ${ws}s...`);
        await sleep(ws * 1000);

        const existingVideoUUIDs = await snapshotVideoUUIDs(Runtime);

        log(`  Bước 1/3 → Bỏ chọn start frame cũ`);
        await deselectStartFrame(Runtime, Input);

        log(`  Bước 2/3 → Select start frame vị trí ${i}`);
        await selectStartFrameByPosition(Runtime, Input, i);

        log(`  Bước 3/3 → Submit (tái dùng prompt)`);
        await submitOnly(Runtime, Input);

        await waitForVideos(Network, Runtime, existingVideoUUIDs);

        const vidFiles = await downloadVideos(Runtime, Input, Page, vidFolder, existingVideoUUIDs);
        allVideos.push(...vidFiles);
        log(`  ✓ ${vidFiles.length} video → ${path.basename(vidFolder)}`);
      }
    }

    // Xoá câu lệnh cuối
    await clearPrompt(Runtime, Input);

    // ───────────────────────────────────────────────────────────
    // TỔNG KẾT
    // ───────────────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`  ✅ HOÀN TẤT (${elapsed}s)`);
    console.log(`  → ${imageCount} ảnh generated`);
    console.log(`  → ${allVideos.length} video đã tải về`);
    console.log(`  → Output: ${OUTPUT_ROOT}`);
    console.log(`${'═'.repeat(65)}\n`);

    console.log(JSON.stringify({ success: true, imageCount, videoCount: allVideos.length }));

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n${'═'.repeat(65)}`);
    console.error(`  ❌ THẤT BẠI (${elapsed}s): ${err.message}`);
    console.error(`${'═'.repeat(65)}\n`);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();