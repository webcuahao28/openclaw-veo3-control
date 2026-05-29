// flowMode/select-options.js
// Selects mode (image/video), aspect ratio, quantity, and model in the Flow generation panel.
// Usage: node flowMode/select-options.js [mode] [aspectRatio] [quantity] [model]
//   mode:        image | video          (default: image)
//   aspectRatio: 16:9|4:3|1:1|3:4|9:16 (default: 1:1)
//   quantity:    1|2|3|4               (default: 2)
//   model:       '' to skip model change

const { connect, sleep, waitForElement, clickAt, findAndClick } = require('./_cdp');

const targetMode  = (process.argv[2] || 'image').toLowerCase();
const targetRatio = process.argv[3] || '1:1';
const targetQty   = parseInt(process.argv[4] || '2', 10);
const targetModel = process.argv[5] || '';

// Map quantity number to the label shown in the UI
const qtyLabel = targetQty <= 1 ? '1x' : `x${targetQty}`;
// Mode label in Vietnamese UI
const modeLabel = targetMode === 'video' ? 'Video' : 'Hình ảnh';

(async () => {
  let client;
  try {
    console.log('\n=== ⚙️ CHỌN CÀI ĐẶT GENERATION ===');
    console.log(`  → Mode: ${modeLabel} | Tỉ lệ: ${targetRatio} | Số lượng: ${qtyLabel}`);

    client = await connect();
    const { Runtime, Input } = client;

    // ── STEP 1: Select Mode (Hình ảnh / Video) ─────────────────────────────
    const modeExpr = `(() => {
      // Try [role="tab"], then any button/div with matching text
      const all = Array.from(document.querySelectorAll('[role="tab"], button'));
      const btn = all.find(el => {
        const t = el.textContent.trim();
        return t === '${modeLabel}' || t.toLowerCase().includes('${targetMode}');
      });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    console.log(`  → Chọn mode: ${modeLabel}`);
    await findAndClick(Runtime, Input, modeExpr, `tab mode=${modeLabel}`);
    await sleep(600);

    // ── STEP 2: Select Aspect Ratio ────────────────────────────────────────
    const ratioExpr = `(() => {
      const ratio = '${targetRatio}';
      // Aspect ratio buttons usually have the ratio text as aria-label or textContent
      const all = Array.from(document.querySelectorAll('button, [role="radio"], [role="option"]'));
      let btn = all.find(el => {
        const t = (el.textContent || '').trim();
        const lbl = el.getAttribute('aria-label') || '';
        return t === ratio || lbl.includes(ratio) || t.replace('\\n','').includes(ratio);
      });
      // Fallback: find by data attribute
      if (!btn) btn = document.querySelector(\`[data-ratio="${targetRatio}"], [aria-label*="${targetRatio}"]\`);
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    console.log(`  → Chọn tỉ lệ: ${targetRatio}`);
    await findAndClick(Runtime, Input, ratioExpr, `ratio=${targetRatio}`);
    await sleep(400);

    // ── STEP 3: Select Quantity ────────────────────────────────────────────
    const qtyExpr = `(() => {
      const label = '${qtyLabel}';
      const all = Array.from(document.querySelectorAll('button, [role="radio"], [role="tab"]'));
      const btn = all.find(el => el.textContent.trim().toLowerCase() === label.toLowerCase());
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    console.log(`  → Chọn số lượng: ${qtyLabel}`);
    await findAndClick(Runtime, Input, qtyExpr, `qty=${qtyLabel}`);
    await sleep(400);

    // ── STEP 4: Select Model (optional) ────────────────────────────────────
    if (targetModel) {
      const modelDropExpr = `(() => {
        const all = Array.from(document.querySelectorAll('button, [role="button"], select'));
        const btn = all.find(el => {
          const t = el.textContent || '';
          return t.toLowerCase().includes('nano banana') || t.toLowerCase().includes('model');
        });
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        if (r.width === 0) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`;

      console.log(`  → Mở dropdown model...`);
      await findAndClick(Runtime, Input, modelDropExpr, 'model dropdown');
      await sleep(800);

      // Pick model from list
      const modelOptExpr = `(() => {
        const model = '${targetModel}';
        const all = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button'));
        const btn = all.find(el => el.textContent.toLowerCase().includes(model.toLowerCase()));
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        if (r.width === 0) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`;

      await findAndClick(Runtime, Input, modelOptExpr, `model option: ${targetModel}`);
      await sleep(400);
    }

    console.log(`\n  ✅ Đã cài đặt xong!`);
    console.log(JSON.stringify({ success: true, mode: modeLabel, ratio: targetRatio, qty: qtyLabel }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
