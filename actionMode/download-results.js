const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');

// Hàm tiện ích
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({type: 'mouseMoved', x, y});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mousePressed', x, y, button: 'left', clickCount: 1});
  await sleep(100);
  await Input.dispatchMouseEvent({type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
}

// Di chuột tới toạ độ để trigger hover (không click)
async function hoverAt(Input, x, y) {
  await Input.dispatchMouseEvent({type: 'mouseMoved', x, y});
  await sleep(600); // Chờ CSS hover transition
}

// Chờ file mới xuất hiện trong thư mục (bỏ qua .crdownload và .tmp)
async function waitForNewFile(folder, existingFiles, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(1000);
    const currentFiles = fs.readdirSync(folder);
    const newFiles = currentFiles.filter(f =>
      !existingFiles.has(f) &&
      !f.endsWith('.crdownload') &&
      !f.endsWith('.tmp') &&
      !f.startsWith('.')
    );
    if (newFiles.length > 0) return newFiles[0];
  }
  return null;
}

const outputFolder = path.resolve(process.argv[2] || '.');
const prefix = process.argv[3] || 'result';
const mode = (process.argv[4] || 'image').toLowerCase(); // 'image' hoặc 'video'

(async function downloadResults() {
  let client;
  try {
    console.log(`\n=== ⬇️ TẢI KẾT QUẢ (${mode.toUpperCase()}) ===`);
    console.log(`  → Thư mục đích: ${outputFolder}`);
    console.log(`  → Prefix       : ${prefix}`);

    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
    }

    const targets = await CDP.List({port: 9222});
    const flowTab = targets.find(t => t.url.includes('labs.google'));
    if (!flowTab) throw new Error('Không tìm thấy tab labs.google!');

    client = await CDP({target: flowTab.id, port: 9222});
    const { Runtime, Input, Page } = client;
    await Runtime.enable();
    await Page.enable();

    // Đặt thư mục download mặc định của Chrome
    await Page.setDownloadBehavior({
      behavior: 'allow',
      downloadPath: outputFolder
    });

    // Snapshot danh sách file hiện có trước khi download
    const existingFiles = new Set(fs.readdirSync(outputFolder));

    // ─────────────────────────────────────────────────────────────────
    // BƯỚC 1: TÌM CÁC RESULT CARD (container chứa ảnh/video kết quả)
    // và HOVER vào từng card để làm hiện nút download ẩn
    // ─────────────────────────────────────────────────────────────────
    console.log(`  → Đang tìm result cards và hover để reveal nút download...`);

    const { result: cardsResult } = await Runtime.evaluate({
      expression: `
        (() => {
          // Tìm các card chứa kết quả: div/section bao quanh img hoặc video lớn
          const mediaEls = Array.from(document.querySelectorAll('${mode === 'video' ? 'video' : 'img'}'))
            .filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 100 && r.height > 100;
            });

          // Với mỗi media, leo lên tìm container card gần nhất
          const cards = [];
          const seen = new Set();
          for (const el of mediaEls) {
            let node = el;
            // Leo lên tối đa 6 cấp để tìm card container
            for (let i = 0; i < 6; i++) {
              if (!node.parentElement) break;
              node = node.parentElement;
              const r = node.getBoundingClientRect();
              // Card phải có kích thước hợp lý và chứa media bên trong
              if (r.width > 100 && r.height > 100 && r.width < 1200) {
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

    const cards = JSON.parse(cardsResult.value || '[]');
    console.log(`  → Tìm thấy ${cards.length} result card(s). Đang hover...`);

    // Hover vào từng card để trigger CSS hover state
    for (const card of cards) {
      await hoverAt(Input, card.x, card.y);
    }

    // Chờ thêm 1 giây sau khi hover để animation/transition hoàn tất
    await sleep(1000);

    // ─────────────────────────────────────────────────────────────────
    // BƯỚC 2: TÌM NÚT DOWNLOAD (sau khi đã hover để làm hiện)
    // ─────────────────────────────────────────────────────────────────
    console.log(`  → Đang tìm nút download...`);

    const { result: btnsResult } = await Runtime.evaluate({
      expression: `
        (() => {
          const allBtns = Array.from(document.querySelectorAll('button, a'));
          const downloadBtns = allBtns.filter(b => {
            // Kiểm tra Material Icon 'download'
            const icon = b.querySelector('i');
            if (icon && icon.textContent.trim().toLowerCase() === 'download') return true;

            // Kiểm tra aria-label
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('download') || label.includes('tải xuống') || label.includes('save')) return true;

            // Kiểm tra title attribute
            const title = (b.getAttribute('title') || '').toLowerCase();
            if (title.includes('download') || title.includes('tải')) return true;

            return false;
          });

          return JSON.stringify(downloadBtns.map(b => {
            const r = b.getBoundingClientRect();
            // Bao gồm cả button ẩn (opacity: 0) nhưng có kích thước (đang hover-triggered)
            const style = window.getComputedStyle(b);
            const visible = r.width > 0 && r.height > 0 &&
              style.display !== 'none' && style.visibility !== 'hidden';
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible };
          }).filter(b => b.visible));
        })()
      `
    });

    const downloadBtns = JSON.parse(btnsResult.value || '[]');
    console.log(`  → Tìm thấy ${downloadBtns.length} nút download.`);

    const downloadedFiles = [];

    // ─────────────────────────────────────────────────────────────────
    // CÁCH 1: Click nút download + chờ file xuất hiện
    // ─────────────────────────────────────────────────────────────────
    if (downloadBtns.length > 0) {
      for (let i = 0; i < downloadBtns.length; i++) {
        const btn = downloadBtns[i];

        // Hover lại vào đúng nút trước khi click (đảm bảo không ẩn)
        await hoverAt(Input, btn.x, btn.y);
        console.log(`  → Click download ${i + 1}/${downloadBtns.length}...`);
        await clickAt(Input, btn.x, btn.y);

        // Chờ file mới xuất hiện (tối đa 60 giây)
        const newFile = await waitForNewFile(outputFolder, existingFiles, 60000);

        if (newFile) {
          const ext = path.extname(newFile);
          const newName = `${prefix}_${String(i + 1).padStart(2, '0')}${ext}`;
          const oldPath = path.join(outputFolder, newFile);
          const newPath = path.join(outputFolder, newName);
          try {
            fs.renameSync(oldPath, newPath);
            downloadedFiles.push(newPath);
            existingFiles.add(newName);
            console.log(`  ✓ Đã lưu: ${newName}`);
          } catch (renameErr) {
            // Rename thất bại → dùng tên gốc
            downloadedFiles.push(oldPath);
            existingFiles.add(newFile);
            console.log(`  ✓ Đã lưu (tên gốc): ${newFile}`);
          }
        } else {
          console.log(`  ⚠️ Timeout chờ file download ${i + 1} (60 giây).`);
        }

        // Di chuột ra giữa màn hình để tránh hover đè lên nút tiếp theo
        await hoverAt(Input, 300, 300);
        await sleep(500);
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // CÁCH 2 (FALLBACK): Trích xuất ảnh/video dưới dạng base64 từ DOM
    // Dùng khi không tìm thấy nút download hoặc download bị thất bại
    // ─────────────────────────────────────────────────────────────────
    if (downloadedFiles.length === 0) {
      console.log(`  → Fallback: trích xuất base64 từ DOM...`);

      const mediaSelector = mode === 'video' ? 'video' : 'img';
      const { result: mediaResult } = await Runtime.evaluate({
        expression: `
          (async () => {
            const els = Array.from(document.querySelectorAll('${mediaSelector}')).filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 100 && r.height > 100 && el.src && el.src.length > 10;
            });

            const results = [];
            for (const el of els) {
              try {
                const res = await fetch(el.src);
                const blob = await res.blob();
                const mimeType = blob.type;
                const base64 = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
                results.push({ base64, mimeType });
              } catch (e) {
                results.push({ error: e.message });
              }
            }
            return JSON.stringify(results);
          })()
        `,
        awaitPromise: true,
        timeout: 120000
      });

      const mediaItems = JSON.parse(mediaResult.value || '[]');
      const mimeToExt = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        'video/mp4': '.mp4', 'video/webm': '.webm'
      };

      for (let i = 0; i < mediaItems.length; i++) {
        const item = mediaItems[i];
        if (item.error || !item.base64) {
          console.log(`  ⚠️ Bỏ qua item ${i + 1}: ${item.error || 'không có data'}`);
          continue;
        }
        const ext = mimeToExt[item.mimeType] || (mode === 'video' ? '.mp4' : '.jpg');
        const filename = `${prefix}_${String(i + 1).padStart(2, '0')}${ext}`;
        const filePath = path.join(outputFolder, filename);
        const base64Data = item.base64.split(',')[1];
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        downloadedFiles.push(filePath);
        console.log(`  ✓ Đã lưu (base64): ${filename}`);
      }
    }

    console.log(`  ✅ Tổng cộng: ${downloadedFiles.length} file(s) đã tải.`);
    console.log(`=========================================\n`);
    console.log(JSON.stringify({
      success: true,
      files: downloadedFiles,
      count: downloadedFiles.length
    }));

  } catch (err) {
    console.error('\n  ❌ LỖI TẢI:', err.message);
    console.log(JSON.stringify({ success: false, files: [], error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
