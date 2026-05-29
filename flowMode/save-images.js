// flowMode/save-images.js
// Downloads all visible generated images from the Flow project and saves them
// to a structured folder path: outputFolder/YYYYMMDD_HHmmss_mode_ratio/img_001.jpg
//
// Usage: node flowMode/save-images.js [outputFolder] [prefix] [mode] [ratio]

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { connect, sleep, waitForElement } = require('./_cdp');

const outputFolder = process.argv[2] || process.cwd();
const prefix       = process.argv[3] || '';
const mode         = process.argv[4] || 'image';
const ratio        = (process.argv[5] || '1x1').replace(':', 'x');

function timestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '_',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('');
}

function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return downloadUrl(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

(async () => {
  let client;
  try {
    console.log('\n=== 💾 LƯU ẢNH ĐÃ TẠO ===');
    client = await connect();
    const { Runtime } = client;

    // Find all generated image URLs in the current view
    const urlsExpr = `(() => {
      // Collect unique image URLs from Google CDN / blob sources
      const imgs = Array.from(document.querySelectorAll('img'));
      const urls = imgs
        .map(el => el.src || el.getAttribute('data-src') || '')
        .filter(s =>
          s.length > 10 &&
          (s.includes('lh3.google') || s.includes('storage.googleapis') || s.includes('blob:') || s.match(/\\.jpg|\\.png|\\.webp/i))
        );
      // Also try CSS background-images
      const bgEls = Array.from(document.querySelectorAll('[style*="background-image"]'));
      bgEls.forEach(el => {
        const m = el.style.backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/);
        if (m) urls.push(m[1]);
      });
      return [...new Set(urls)];
    })()`;

    const urls = await waitForElement(Runtime, urlsExpr, 5, 500);
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      console.log('  ⚠️ Không tìm thấy ảnh nào để lưu (trang có thể chưa có kết quả).');
      console.log(JSON.stringify({ success: true, saved: 0 }));
      return;
    }

    console.log(`  → Tìm thấy ${urls.length} ảnh`);

    // Build output directory
    const dirName   = `${timestamp()}_${prefix ? prefix + '_' : ''}${mode}_${ratio}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const targetDir = path.join(outputFolder, dirName);
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`  → Thư mục: ${targetDir}`);

    // Handle blob: URLs differently (screenshot via CDP)
    let saved = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const ext  = (url.match(/\.(jpg|jpeg|png|webp)/i) || ['', 'jpg'])[1] || 'jpg';
      const name = `img_${String(i + 1).padStart(3, '0')}.${ext}`;
      const dest = path.join(targetDir, name);

      try {
        if (url.startsWith('blob:')) {
          // Download blob via CDP Runtime.evaluate → base64
          const { result } = await Runtime.evaluate({
            expression: `(async () => {
              const res = await fetch('${url}');
              const buf = await res.arrayBuffer();
              const bytes = new Uint8Array(buf);
              let b = '';
              bytes.forEach(b2 => b += String.fromCharCode(b2));
              return btoa(b);
            })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          if (result.value) {
            fs.writeFileSync(dest, Buffer.from(result.value, 'base64'));
            console.log(`  → Lưu (blob): ${name}`);
            saved++;
          }
        } else {
          await downloadUrl(url, dest);
          console.log(`  → Lưu: ${name}`);
          saved++;
        }
      } catch (e) {
        console.warn(`  ⚠️ Bỏ qua ảnh ${i + 1}: ${e.message}`);
      }
    }

    console.log(`\n  ✅ Đã lưu ${saved}/${urls.length} ảnh vào: ${targetDir}`);
    console.log(JSON.stringify({ success: true, saved, total: urls.length, folder: targetDir }));
  } catch (err) {
    console.error('\n  ❌ LỖI:', err.message);
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
})();
