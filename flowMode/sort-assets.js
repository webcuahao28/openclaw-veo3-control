// flowMode/sort-assets.js
// Opens the sort/filter menu and selects a sort option in the Flow asset panel.
// Usage: node flowMode/sort-assets.js [sortOption]
//   sortOption: recent|oldest|name   (default: recent)

const { connect, sleep, findAndClick, waitForElement, clickAt } = require('./_cdp');

const SORT_MAP = {
  recent:  ['Gần đây nhất', 'Recent', 'Mới nhất'],
  oldest:  ['Cũ nhất', 'Oldest'],
  name:    ['Tên', 'Name'],
};

const sortKey = (process.argv[2] || 'recent').toLowerCase();
const sortLabels = SORT_MAP[sortKey] || SORT_MAP.recent;

(async () => {
  let client;
  try {
    console.log(`\n=== 🔃 SẮP XẾP TÀI SẢN: ${sortKey} ===`);
    client = await connect();
    const { Runtime, Input } = client;

    // Find sort/filter button — often a funnel/filter icon or "Sắp xếp" text
    const sortBtnExpr = `(() => {
      const all = Array.from(document.querySelectorAll('button, [role="button"]'));
      const btn = all.find(el => {
        const t = el.textContent || '';
        const lbl = el.getAttribute('aria-label') || '';
        return t.includes('Sắp xếp') || t.includes('Sort') || t.includes('Lọc') ||
               lbl.includes('sort') || lbl.includes('filter') ||
               el.querySelector('mat-icon, [class*="filter"], [class*="sort"]');
      });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    console.log('  → Tìm nút sort/filter...');
    await findAndClick(Runtime, Input, sortBtnExpr, 'sort button');
    await sleep(700);

    // Pick the sort option from the opened menu
    const optExpr = `(() => {
      const labels = ${JSON.stringify(sortLabels)};
      const all = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"], li, button'));
      const btn = all.find(el => {
        const t = el.textContent.trim();
        return labels.some(l => t.includes(l));
      });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;

    console.log(`  → Chọn option: ${sortLabels[0]}`);
    await findAndClick(Runtime, Input, optExpr, `sort option: ${sortLabels[0]}`);
    await sleep(500);

    console.log(`  ✅ Đã sắp xếp theo: ${sortLabels[0]}`);
    console.log(JSON.stringify({ success: true, sortBy: sortKey }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
