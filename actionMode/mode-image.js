const CDP = require('chrome-remote-interface');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function switchToImage() {
  let client;
  try {
    console.log('\n=== ĐỔI SANG MODE HÌNH ẢNH ===');
    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const {Runtime, Input} = client;
    await Runtime.enable();

    // 1. Tìm và click mở menu
    const {result: menuBtnRes} = await Runtime.evaluate({
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
          const btn = btns.find(b => /nano banana|video|veo/i.test(b.textContent));
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
        })()
      `
    });

    if (!menuBtnRes.value) throw new Error('Không tìm thấy nút Menu!');
    const menuPos = JSON.parse(menuBtnRes.value);
    
    await Input.dispatchMouseEvent({type: 'mouseMoved', x: menuPos.x, y: menuPos.y});
    await sleep(200);
    await Input.dispatchMouseEvent({type: 'mousePressed', x: menuPos.x, y: menuPos.y, button: 'left', clickCount: 1});
    await sleep(100);
    await Input.dispatchMouseEvent({type: 'mouseReleased', x: menuPos.x, y: menuPos.y, button: 'left', clickCount: 1});
    
    await sleep(800); // Chờ menu xổ xuống

    // 2. Tìm và click tab "Hình ảnh"
    const {result: tabBtnRes} = await Runtime.evaluate({
      expression: `
        (() => {
          const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
          const btn = tabs.find(b => {
             const t = b.textContent.toLowerCase();
             return t.includes('hình') && t.includes('ảnh');
          });
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
        })()
      `
    });

    if (!tabBtnRes.value) throw new Error('Không tìm thấy tab "Hình ảnh" trong menu!');
    const tabPos = JSON.parse(tabBtnRes.value);

    await Input.dispatchMouseEvent({type: 'mouseMoved', x: tabPos.x, y: tabPos.y});
    await sleep(300);
    await Input.dispatchMouseEvent({type: 'mousePressed', x: tabPos.x, y: tabPos.y, button: 'left', clickCount: 1});
    await sleep(100);
    await Input.dispatchMouseEvent({type: 'mouseReleased', x: tabPos.x, y: tabPos.y, button: 'left', clickCount: 1});

    await sleep(800);
    console.log('  → ✓ Đã chuyển sang mode HÌNH ẢNH thành công!\n');

  } catch (err) {
    console.error('  → ❌ Lỗi:', err.message);
  } finally {
    if (client) await client.close();
  }
})();