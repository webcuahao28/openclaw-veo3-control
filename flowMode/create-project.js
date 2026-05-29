// flowMode/create-project.js
// Clicks "+ Dự án mới" on the Flow home page and waits for the project editor to load.
// Usage: node flowMode/create-project.js

const { connect, sleep, waitForElement, findAndClick } = require('./_cdp');

(async () => {
  let client;
  try {
    console.log('\n=== 📁 TẠO DỰ ÁN MỚI ===');
    client = await connect();
    const { Runtime, Input, Page } = client;

    // Make sure we're on the Flow home page
    const { result: urlRes } = await Runtime.evaluate({ expression: 'location.href', returnByValue: true });
    const currentUrl = urlRes.value || '';
    if (!currentUrl.includes('labs.google')) throw new Error('Tab không phải labs.google!');

    if (!currentUrl.includes('/flow')) {
      console.log('  → Đang điều hướng đến trang Flow...');
      await Page.navigate({ url: 'https://labs.google/fx/vi/tools/flow' });
      await sleep(2000);
    }

    // Find "+ Dự án mới" button — tries multiple selector strategies
    const expr = `(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const btn = candidates.find(el => {
        const t = el.textContent || el.getAttribute('aria-label') || '';
        return t.includes('Dự án mới') || t.includes('New project') || t.includes('dự án');
      });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    console.log('  → Tìm nút "+ Dự án mới"...');
    await findAndClick(Runtime, Input, expr, '+ Dự án mới');
    console.log('  → Đã click. Chờ project editor mở...');
    await sleep(3000);

    // Verify we moved into a project
    const { result: newUrl } = await Runtime.evaluate({ expression: 'location.href', returnByValue: true });
    console.log(`  ✅ Đã tạo dự án mới! URL hiện tại: ${newUrl.value}`);
    console.log(JSON.stringify({ success: true, url: newUrl.value }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
