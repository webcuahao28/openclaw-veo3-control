const CDP = require('chrome-remote-interface');

// Hàm tiện ích chờ
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const mode = (process.argv[2] || 'image').toLowerCase(); // 'image' hoặc 'video'
const maxWaitSec = parseInt(process.argv[3] || '300', 10);

(async function waitForResults() {
  let client;
  try {
    console.log(`\n=== ⏳ CHỜ KẾT QUẢ GENERATION ===`);
    console.log(`  → Mode: ${mode.toUpperCase()}`);
    console.log(`  → Tối đa: ${maxWaitSec} giây`);

    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const { Runtime } = client;
    await Runtime.enable();

    // Chờ tối thiểu 8 giây để generation bắt đầu khởi động
    console.log(`  → Chờ generation khởi động (8 giây)...`);
    await sleep(8000);

    const startTime = Date.now();
    const maxWaitMs = maxWaitSec * 1000;
    let attempts = 0;

    while (Date.now() - startTime < maxWaitMs) {
      attempts++;
      await sleep(3000);

      const { result } = await Runtime.evaluate({
        expression: `
          (() => {
            // --- Kiểm tra loading/spinner đang hoạt động ---
            const loadingSelectors = [
              'mat-progress-bar',
              'mat-spinner',
              '[role="progressbar"]',
              '.progress-bar',
              '[class*="shimmer"]',
              '[class*="skeleton"]',
              '[aria-busy="true"]'
            ];
            const isLoading = loadingSelectors.some(sel => {
              const els = Array.from(document.querySelectorAll(sel));
              return els.some(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              });
            });

            // --- Kiểm tra nút Submit có enabled không ---
            // Khi đang gen, nút bị disabled hoặc biến thành nút Stop
            const submitBtn = Array.from(document.querySelectorAll('button')).find(b => {
              const icon = b.querySelector('i');
              return icon && icon.textContent.trim() === 'arrow_forward';
            });
            const submitEnabled = submitBtn ? !submitBtn.disabled : false;

            // --- Đếm kết quả: ảnh lớn hiển thị ---
            const resultImgs = Array.from(document.querySelectorAll('img')).filter(img => {
              const r = img.getBoundingClientRect();
              return r.width > 100 && r.height > 100 && img.src && img.src.length > 10;
            });

            // --- Đếm video hiển thị ---
            const resultVideos = Array.from(document.querySelectorAll('video')).filter(v => {
              const r = v.getBoundingClientRect();
              return r.width > 100 && r.height > 100;
            });

            return JSON.stringify({
              isLoading,
              submitEnabled,
              imageCount: resultImgs.length,
              videoCount: resultVideos.length,
              totalResults: resultImgs.length + resultVideos.length
            });
          })()
        `
      });

      if (!result || !result.value) continue;

      const data = JSON.parse(result.value);
      console.log(`  → Lần ${attempts}: loading=${data.isLoading}, submitOK=${data.submitEnabled}, img=${data.imageCount}, video=${data.videoCount}`);

      // Điều kiện hoàn thành:
      // 1. Không còn loading indicator
      // 2. Nút Submit đã enabled trở lại
      // 3. Có ít nhất 1 kết quả theo mode hiện tại
      const hasResults = mode === 'video'
        ? data.videoCount >= 1
        : data.imageCount >= 1;

      if (!data.isLoading && data.submitEnabled && hasResults) {
        const finalCount = mode === 'video' ? data.videoCount : data.imageCount;
        console.log(`  ✅ Generation hoàn tất! Có ${finalCount} kết quả sẵn sàng.`);
        console.log(`====================================================\n`);
        console.log(JSON.stringify({ success: true, count: finalCount, mode }));
        process.exit(0);
      }
    }

    throw new Error(`Timeout sau ${maxWaitSec} giây - không nhận được kết quả generation!`);

  } catch (err) {
    console.error('\n  ❌ LỖI CHỜ KẾT QUẢ:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
