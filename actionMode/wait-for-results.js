const CDP = require('chrome-remote-interface');

// Hàm tiện ích chờ
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const mode = (process.argv[2] || 'image').toLowerCase(); // 'image' hoặc 'video'
const maxWaitSec = parseInt(process.argv[3] || '300', 10);

// ─────────────────────────────────────────────────────────────────────────────
// Chiến lược 2 pha để tránh đọc nhầm kết quả CŨ còn trên trang:
//
//   Phase 1 (tối đa 20 giây): Chờ loading BẮT ĐẦU (xác nhận generation mới đã khởi động)
//   Phase 2 (tối đa maxWaitSec): Chờ loading KẾT THÚC + có kết quả mới
//
// Lý do: Sau khi submit prompt mới, trang sẽ xoá kết quả cũ và hiện spinner.
// Nếu chỉ kiểm tra "có kết quả chưa?", script sẽ đọc nhầm kết quả của lần trước.
// ─────────────────────────────────────────────────────────────────────────────

(async function waitForResults() {
  let client;
  try {
    console.log(`\n=== ⏳ CHỜ KẾT QUẢ GENERATION ===`);
    console.log(`  → Mode    : ${mode.toUpperCase()}`);
    console.log(`  → Tối đa  : ${maxWaitSec} giây`);

    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const { Runtime } = client;
    await Runtime.enable();

    // ─────────────────────────────────────────────
    // Biểu thức đánh giá trạng thái trang
    // ─────────────────────────────────────────────
    const stateExpr = `
      (() => {
        // 1. Kiểm tra loading indicator
        const loadingSelectors = [
          'mat-progress-bar', 'mat-spinner',
          '[role="progressbar"]', '.progress-bar',
          '[class*="shimmer"]', '[class*="skeleton"]',
          '[aria-busy="true"]'
        ];
        const isLoading = loadingSelectors.some(sel => {
          const els = Array.from(document.querySelectorAll(sel));
          return els.some(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
        });

        // 2. Kiểm tra nút Submit (arrow_forward) có enabled không
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => {
          const icon = b.querySelector('i');
          return icon && icon.textContent.trim() === 'arrow_forward';
        });
        const submitEnabled = submitBtn ? !submitBtn.disabled : false;

        // 3. Đếm ảnh kết quả (lớn, hiển thị trên viewport)
        const resultImgs = Array.from(document.querySelectorAll('img')).filter(img => {
          const r = img.getBoundingClientRect();
          return r.width > 100 && r.height > 100 && img.src && img.src.length > 10;
        });

        // 4. Đếm video kết quả
        const resultVideos = Array.from(document.querySelectorAll('video')).filter(v => {
          const r = v.getBoundingClientRect();
          return r.width > 100 && r.height > 100;
        });

        return JSON.stringify({
          isLoading,
          submitEnabled,
          imageCount: resultImgs.length,
          videoCount: resultVideos.length
        });
      })()
    `;

    // ─────────────────────────────────────────────
    // PHASE 1: Chờ loading BẮT ĐẦU (tối đa 20 giây)
    // Mục đích: Xác nhận rằng generation mới ĐÃ khởi động
    // ─────────────────────────────────────────────
    console.log(`\n  [Phase 1] Chờ generation khởi động (tối đa 20 giây)...`);
    const phase1Deadline = Date.now() + 20000;
    let loadingDetected = false;

    while (Date.now() < phase1Deadline) {
      await sleep(1500);
      const { result } = await Runtime.evaluate({ expression: stateExpr });
      if (!result || !result.value) continue;
      const data = JSON.parse(result.value);
      console.log(`  → Phase 1: loading=${data.isLoading}, submitOK=${data.submitEnabled}`);

      if (data.isLoading) {
        loadingDetected = true;
        console.log(`  ✓ Loading đã bắt đầu. Chuyển sang Phase 2.`);
        break;
      }

      // Nếu nút Submit bị disable → generation đang bắt đầu, tiếp tục chờ
      if (!data.submitEnabled) {
        loadingDetected = true;
        console.log(`  ✓ Submit bị vô hiệu hoá → generation đang chạy. Chuyển sang Phase 2.`);
        break;
      }
    }

    if (!loadingDetected) {
      console.log(`  ⚠️ Không phát hiện loading trong 20 giây.`);
      console.log(`     Có thể generation bắt đầu và kết thúc rất nhanh. Tiếp tục kiểm tra...`);
    }

    // ─────────────────────────────────────────────
    // PHASE 2: Chờ loading KẾT THÚC + có kết quả (tối đa maxWaitSec)
    // ─────────────────────────────────────────────
    console.log(`\n  [Phase 2] Chờ kết quả hoàn tất (tối đa ${maxWaitSec} giây)...`);
    const phase2Deadline = Date.now() + maxWaitSec * 1000;
    let attempts = 0;

    while (Date.now() < phase2Deadline) {
      attempts++;
      await sleep(3000);

      const { result } = await Runtime.evaluate({ expression: stateExpr });
      if (!result || !result.value) continue;

      const data = JSON.parse(result.value);
      const count = mode === 'video' ? data.videoCount : data.imageCount;
      console.log(`  → Phase 2 (lần ${attempts}): loading=${data.isLoading}, submitOK=${data.submitEnabled}, ${mode}=${count}`);

      // Điều kiện hoàn thành:
      // - Không còn loading
      // - Nút Submit đã enabled (generation xong)
      // - Có ít nhất 1 kết quả theo đúng mode
      if (!data.isLoading && data.submitEnabled && count >= 1) {
        console.log(`\n  ✅ Generation hoàn tất! Có ${count} ${mode} sẵn sàng.`);
        console.log(`====================================================\n`);
        console.log(JSON.stringify({ success: true, count, mode }));
        process.exit(0);
      }
    }

    throw new Error(`Timeout sau ${maxWaitSec} giây - không nhận được kết quả!`);

  } catch (err) {
    console.error('\n  ❌ LỖI CHỜ KẾT QUẢ:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
