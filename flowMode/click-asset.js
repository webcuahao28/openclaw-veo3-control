// flowMode/click-asset.js
// Clicks on an asset (image/video) in the Flow project grid.
// Usage: node flowMode/click-asset.js [index]
//   index: 0-based index of the visible asset grid item (default: 0 = first)

const { connect, sleep, waitForElement, clickAt } = require('./_cdp');

const assetIndex = parseInt(process.argv[2] || '0', 10);

(async () => {
  let client;
  try {
    console.log(`\n=== 🖱️ CLICK TÀI SẢN #${assetIndex} ===`);
    client = await connect();
    const { Runtime, Input } = client;

    // Find asset grid items — Flow uses img thumbnails or card containers
    const assetExpr = `(() => {
      // Try multiple common grid item selectors
      const selectors = [
        'img[src*="lh3.google"], img[src*="storage.googleapis"]',
        '[class*="asset"], [class*="card"], [class*="thumbnail"]',
        '[role="img"], figure',
      ];
      let items = [];
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel))
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 30 && r.height > 30; });
        if (found.length > 0) { items = found; break; }
      }
      const el = items[${assetIndex}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, total: items.length };
    })()`;

    const pos = await waitForElement(Runtime, assetExpr, 10, 500);
    if (!pos) throw new Error(`Không tìm thấy tài sản thứ ${assetIndex} (grid có thể trống)`);

    console.log(`  → Click tài sản #${assetIndex} tại (${Math.round(pos.x)}, ${Math.round(pos.y)}) — tổng: ${pos.total}`);
    await clickAt(Input, pos.x, pos.y);
    await sleep(600);

    console.log(`  ✅ Đã click tài sản #${assetIndex}`);
    console.log(JSON.stringify({ success: true, index: assetIndex, total: pos.total }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
