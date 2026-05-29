// flowMode/open-tab.js
// Opens a new browser tab to the given URL (default: Flow home),
// then closes all other labs.google Flow tabs.
// Usage: node flowMode/open-tab.js [url]

const CDP = require('chrome-remote-interface');
const { CDP_PORT, sleep, getFlowTab } = require('./_cdp');

const TARGET_URL = process.argv[2] || 'https://labs.google/fx/vi/tools/flow';

(async () => {
  let browser;
  try {
    console.log('\n=== 🌐 MỞ TAB MỚI ===');
    console.log(`  → URL: ${TARGET_URL}`);

    // Connect to browser (not a page tab)
    const wsUrl = await new Promise((resolve, reject) => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data).webSocketDebuggerUrl));
      });
      req.on('error', reject);
    });

    browser = await CDP({ webSocketUrl: wsUrl });
    const { Target } = browser;

    // Get all existing Flow tabs
    const targets = await CDP.List({ port: CDP_PORT });
    const flowTabs = targets.filter(
      (t) => t.type === 'page' && t.url.includes('labs.google')
    );

    // Open new tab
    const { targetId: newTabId } = await Target.createTarget({ url: TARGET_URL });
    console.log(`  → Mở tab mới (targetId: ${newTabId})`);
    await sleep(2500);

    // Close old Flow tabs
    for (const tab of flowTabs) {
      console.log(`  → Đóng tab cũ: ${tab.url}`);
      await Target.closeTarget({ targetId: tab.id });
      await sleep(300);
    }

    console.log(`  ✅ Hoàn tất! Tab mới đang mở tại: ${TARGET_URL}`);
    console.log(JSON.stringify({ success: true, url: TARGET_URL, closedTabs: flowTabs.length }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
