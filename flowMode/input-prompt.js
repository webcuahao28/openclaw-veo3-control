// flowMode/input-prompt.js
// Types a prompt into the Flow generation panel and submits it.
// Usage: node flowMode/input-prompt.js "prompt text" [pastePercentage]
//   pastePercentage: 0-100, how much of the text to paste (default: 60)

const { connect, sleep, waitForElement, clickAt } = require('./_cdp');

const promptText     = process.argv[2] || '';
const pastePercent   = Math.max(0, Math.min(100, parseInt(process.argv[3] || '60', 10)));

async function typeSimulated(Input, text) {
  for (const char of text) {
    await Input.dispatchKeyEvent({ type: 'keyDown', text: char });
    await Input.dispatchKeyEvent({ type: 'keyUp', text: char });
    await sleep(Math.floor(Math.random() * 55) + 25);
  }
}

(async () => {
  let client;
  try {
    console.log('\n=== ⌨️ NHẬP PROMPT & SUBMIT ===');
    if (!promptText) throw new Error('Chưa cung cấp prompt!');

    // Split: type front → paste middle → type back
    const pasteLen    = Math.floor(promptText.length * (pastePercent / 100));
    const typeLen     = promptText.length - pasteLen;
    const typeFront   = promptText.substring(0, Math.floor(typeLen / 2));
    const pasteMiddle = promptText.substring(typeFront.length, typeFront.length + pasteLen);
    const typeBack    = promptText.substring(typeFront.length + pasteLen);

    console.log(`  → Prompt (${promptText.length} ký tự, paste ${pastePercent}%)`);

    client = await connect();
    const { Runtime, Input } = client;

    // ── Find the prompt textarea / contenteditable ──────────────────────────
    const inputExpr = `(() => {
      // Flow uses a textarea or contenteditable for the prompt
      const candidates = [
        ...Array.from(document.querySelectorAll('textarea')),
        ...Array.from(document.querySelectorAll('[contenteditable="true"]')),
        ...Array.from(document.querySelectorAll('[role="textbox"]')),
      ];
      const el = candidates.find(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 100 || r.height < 20) return false;
        const ph = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.textContent || '';
        return ph.includes('Bạn muốn') || ph.includes('create') || ph.includes('tạo') || r.height > 30;
      }) || candidates.find(el => el.getBoundingClientRect().width > 100);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 };
    })()`;

    const editorPos = await waitForElement(Runtime, inputExpr, 15, 400);
    if (!editorPos) throw new Error('Không tìm thấy ô nhập prompt!');

    console.log(`  → Tìm thấy input tại (${Math.round(editorPos.x)}, ${Math.round(editorPos.y)})`);

    // Click and clear
    await clickAt(Input, editorPos.x, editorPos.y);
    await sleep(300);
    await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 0 });
    await Input.dispatchKeyEvent({ type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 8 });
    await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'a', code: 'KeyA', modifiers: 8 });
    await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Control', code: 'ControlLeft', modifiers: 0 });
    await sleep(150);
    await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Delete', code: 'Delete' });
    await Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Delete', code: 'Delete' });
    await sleep(200);

    // Type / paste
    if (typeFront) { console.log('  → Gõ phần đầu...'); await typeSimulated(Input, typeFront); await sleep(150); }
    if (pasteMiddle) {
      console.log('  → Paste phần giữa...');
      await Input.insertText({ text: pasteMiddle });
      await sleep(200);
    }
    if (typeBack) { console.log('  → Gõ phần cuối...'); await typeSimulated(Input, typeBack); await sleep(150); }
    await sleep(400);

    // ── Find and click the submit/generate button ───────────────────────────
    const submitExpr = `(() => {
      const all = Array.from(document.querySelectorAll('button'));
      // Try arrow_forward icon (Material icon text)
      let btn = all.find(b => {
        if (b.disabled) return false;
        const icon = b.querySelector('mat-icon, i');
        return icon && (icon.textContent.trim() === 'arrow_forward' || icon.textContent.includes('→'));
      });
      // Fallback: look for a button with "→" text or "Tạo" / "Generate"
      if (!btn) btn = all.find(b => !b.disabled && (b.textContent.includes('→') || b.textContent.trim() === 'Tạo' || b.textContent.toLowerCase().includes('generate')));
      // Fallback: the bottom-bar submit button (aria-label)
      if (!btn) btn = document.querySelector('[aria-label*="generate"], [aria-label*="create"], [aria-label*="tạo"]');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    const submitPos = await waitForElement(Runtime, submitExpr, 10, 400);
    if (!submitPos) throw new Error('Không tìm thấy nút Submit!');

    console.log('  → Click Submit...');
    await clickAt(Input, submitPos.x, submitPos.y);
    await sleep(500);

    console.log('  ✅ ĐÃ GỬI PROMPT!');
    console.log(JSON.stringify({ success: true, promptLength: promptText.length }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
