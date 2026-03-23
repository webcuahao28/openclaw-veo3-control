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
    console.log(`  → Prefix: ${prefix}`);

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

    // ─────────────────────────────────────────────────────
    // CÁCH 1: TÌM VÀ CLICK CÁC NÚT DOWNLOAD TRÊN TRANG
    // ─────────────────────────────────────────────────────
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
            return {
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
              visible: r.width > 0 && r.height > 0
            };
          }).filter(b => b.visible));
        })()
      `
    });

    const downloadBtns = JSON.parse(btnsResult.value || '[]');
    console.log(`  → Tìm thấy ${downloadBtns.length} nút download.`);

    const downloadedFiles = [];

    if (downloadBtns.length > 0) {
      // Click từng nút download và đợi file xuất hiện
      for (let i = 0; i < downloadBtns.length; i++) {
        console.log(`  → Click download ${i + 1}/${downloadBtns.length}...`);
        await clickAt(Input, downloadBtns[i].x, downloadBtns[i].y);

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
            // Nếu rename lỗi, giữ tên cũ
            downloadedFiles.push(oldPath);
            existingFiles.add(newFile);
            console.log(`  ✓ Đã lưu (tên gốc): ${newFile}`);
          }
        } else {
          console.log(`  ⚠️ Timeout chờ file download ${i + 1} (60 giây).`);
        }

        await sleep(1000);
      }
    } else {
      // ─────────────────────────────────────────────────────────────────
      // CÁCH 2 (FALLBACK): Trích xuất ảnh/video dưới dạng base64 từ DOM
      // ─────────────────────────────────────────────────────────────────
      console.log(`  → Không tìm thấy nút download. Dùng phương thức trích xuất base64...`);

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
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/webm': '.webm'
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
