/**
 * process-tasks.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quy trình tự động xử lý ảnh từ thư mục Tasks:
 *   1. Quét G:\My Drive\Tasks → lấy danh sách ảnh
 *   2. Với mỗi ảnh:
 *      [PHASE 1] Setup ảnh x4 → Upload → Lấy prompt ảnh → Submit → Chờ → Tải 4 ảnh về
 *      [PHASE 2] Với mỗi ảnh đã gen:
 *                Setup video x4 → Click "Bắt đầu" → Chọn ảnh gen → Lấy prompt video → Submit → Chờ → Tải video về
 *      [PHASE 3] Chuyển ảnh gốc từ Tasks → Done
 *   3. Ghi log từng bước vào G:\My Drive\Logs\workflow-YYYY-MM-DD.log
 *
 * Cách chạy: node workflow/process-tasks.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════
// CẤU HÌNH - Chỉnh theo máy của bạn nếu cần
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  TASKS_FOLDER:  'G:\\My Drive\\Tasks',
  DONE_FOLDER:   'G:\\My Drive\\Done',
  OUTPUT_FOLDER: 'G:\\My Drive\\Output',
  LOGS_FOLDER:   'G:\\My Drive\\Logs',
  SCRIPTS_BASE:  'C:\\Users\\ADMIN\\openClawVeo3',
  IMAGE_WAIT_SEC: 300,   // Chờ tối đa 5 phút cho ảnh
  VIDEO_WAIT_SEC: 420,   // Chờ tối đa 7 phút cho video
};

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

// ═══════════════════════════════════════════════════════════════════
// TIỆN ÍCH
// ═══════════════════════════════════════════════════════════════════

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function log(logFile, message) {
  const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
  const line = `[${ts}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch (e) {
    // Không dừng workflow nếu ghi log thất bại
  }
}

/**
 * Chạy một lệnh Node.js, ghi output vào log, trả về stdout dạng string.
 * Throw nếu exit code != 0.
 */
function runScript(logFile, command, timeoutMs) {
  const timeout = timeoutMs || 600000; // Mặc định 10 phút
  log(logFile, `  ▶ ${command}`);
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: timeout,
      windowsHide: false
    });
    const trimmed = output.trim();
    if (trimmed) {
      // In output nhưng indent cho dễ đọc
      trimmed.split('\n').forEach(line => log(logFile, `    │ ${line}`));
    }
    return trimmed;
  } catch (err) {
    const errOutput = ((err.stdout || '') + (err.stderr || '')).trim() || err.message;
    log(logFile, `  ❌ LỖI SCRIPT: ${errOutput}`);
    throw new Error(errOutput);
  }
}

/**
 * Tìm JSON object cuối cùng trong output của một script.
 * Các script trong codebase luôn in JSON ở dòng cuối.
 */
function parseLastJSON(output) {
  const lines = output.split('\n').map(l => l.trim()).reverse();
  for (const line of lines) {
    if (line.startsWith('{') && line.endsWith('}')) {
      try { return JSON.parse(line); } catch (e) { /* tiếp tục */ }
    }
  }
  throw new Error('Không tìm thấy JSON trong output của script!');
}

/**
 * Phân tích tên file để lấy product và context.
 * Quy ước đặt tên: <product>_<context>.ext  hoặc  <product>.ext
 * Ví dụ: hat_beach.jpg → { product: 'hat', context: 'beach' }
 *         sunglasses.png → { product: 'sunglasses', context: null }
 */
function parseFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const parts = base.split('_');
  return {
    product: parts[0] || 'product',
    context: parts.length > 1 ? parts.slice(1).join(' ') : null
  };
}

// ═══════════════════════════════════════════════════════════════════
// XỬ LÝ TỪNG TASK (MỖI ẢNH GỐC = 1 TASK)
// ═══════════════════════════════════════════════════════════════════

function processImage(imageFile, logFile) {
  const imagePath = path.join(CONFIG.TASKS_FOLDER, imageFile);
  const { product, context } = parseFilename(imageFile);
  const taskName = path.basename(imageFile, path.extname(imageFile));

  // Thư mục output cho task này
  const taskOutputDir  = path.join(CONFIG.OUTPUT_FOLDER, taskName);
  const imageOutputDir = path.join(taskOutputDir, 'images');
  const videoOutputDir = path.join(taskOutputDir, 'videos');
  [taskOutputDir, imageOutputDir, videoOutputDir].forEach(ensureDir);

  const S = CONFIG.SCRIPTS_BASE; // shorthand
  const contextArg = context ? ` "${context}"` : '';

  log(logFile, `\n${'═'.repeat(65)}`);
  log(logFile, `▶  TASK: "${imageFile}"`);
  log(logFile, `   Product: "${product}" | Context: "${context || 'none'}"`);
  log(logFile, `${'═'.repeat(65)}`);

  // ─────────────────────────────────────────────────────────────
  // PHASE 1: TẠO 4 ẢNH TỪ ẢNH GỐC
  // ─────────────────────────────────────────────────────────────
  log(logFile, `\n[PHASE 1/3] TẠO 4 ẢNH`);

  // Bước 1: Lấy prompt ảnh
  log(logFile, `  Bước 1/5 → Lấy prompt ảnh từ Google Sheet...`);
  const imgPromptOut = runScript(logFile,
    `node "${S}\\checkTasks\\get-random-prompt.js" image "${product}"${contextArg}`
  );
  const imgPromptData = parseLastJSON(imgPromptOut);
  if (!imgPromptData.hasPrompt) {
    throw new Error(`Lấy prompt ảnh thất bại: ${imgPromptData.error}`);
  }
  log(logFile, `  ✓ Prompt ảnh: "${imgPromptData.promptText.substring(0, 80)}..."`);

  // Bước 2: Setup mode ảnh x4
  log(logFile, `  Bước 2/5 → Setup mode ảnh x4...`);
  runScript(logFile, `node "${S}\\actionMode\\setup-bot-action-mode.js" image x4`);

  // Bước 3: Upload ảnh gốc
  log(logFile, `  Bước 3/5 → Upload ảnh gốc: ${imageFile}...`);
  runScript(logFile, `node "${S}\\actionMode\\upload-image.js" "${imagePath}"`);

  // Bước 4: Nhập prompt ảnh và submit
  log(logFile, `  Bước 4/5 → Nhập prompt và gửi...`);
  const safeImgPrompt = imgPromptData.promptText.replace(/"/g, '\\"');
  runScript(logFile, `node "${S}\\actionMode\\action-input-prompt.js" "${safeImgPrompt}" 70`);

  // Bước 5: Chờ 4 ảnh được generate xong
  log(logFile, `  Bước 5/5 → Chờ 4 ảnh generation hoàn tất (tối đa ${CONFIG.IMAGE_WAIT_SEC}s)...`);
  const waitImgOut = runScript(logFile,
    `node "${S}\\actionMode\\wait-for-results.js" image ${CONFIG.IMAGE_WAIT_SEC}`,
    (CONFIG.IMAGE_WAIT_SEC + 30) * 1000
  );
  const waitImgData = parseLastJSON(waitImgOut);
  if (!waitImgData.success) {
    throw new Error(`Chờ ảnh thất bại: ${waitImgData.error}`);
  }
  log(logFile, `  ✓ Đã tạo xong ${waitImgData.count} ảnh.`);

  // Tải 4 ảnh đã gen về máy
  log(logFile, `  → Tải ${waitImgData.count} ảnh đã tạo về máy...`);
  const dlImgOut = runScript(logFile,
    `node "${S}\\actionMode\\download-results.js" "${imageOutputDir}" "${taskName}_img" image`
  );
  const dlImgData = parseLastJSON(dlImgOut);
  if (!dlImgData.success || dlImgData.files.length === 0) {
    throw new Error('Tải ảnh về máy thất bại!');
  }
  log(logFile, `  ✓ Đã tải ${dlImgData.files.length} ảnh → ${imageOutputDir}`);

  const generatedImages = dlImgData.files;

  // ─────────────────────────────────────────────────────────────
  // PHASE 2: TẠO VIDEO TỪ TỪNG ẢNH ĐÃ GENERATE
  // ─────────────────────────────────────────────────────────────
  log(logFile, `\n[PHASE 2/3] TẠO ${generatedImages.length} VIDEO`);

  const downloadedVideos = [];

  for (let i = 0; i < generatedImages.length; i++) {
    const genImg = generatedImages[i];
    const vidNum = String(i + 1).padStart(2, '0');

    log(logFile, `\n  ── Video ${i + 1}/${generatedImages.length} | Từ: ${path.basename(genImg)} ──`);

    // Bước 1: Lấy prompt video
    log(logFile, `    Bước 1/5 → Lấy prompt video...`);
    const vidPromptOut = runScript(logFile,
      `node "${S}\\checkTasks\\get-random-prompt.js" video "${product}"${contextArg}`
    );
    const vidPromptData = parseLastJSON(vidPromptOut);
    if (!vidPromptData.hasPrompt) {
      log(logFile, `    ⚠️ Không lấy được prompt video ${i + 1}: ${vidPromptData.error}. Bỏ qua.`);
      continue;
    }
    log(logFile, `    ✓ Prompt video: "${vidPromptData.promptText.substring(0, 80)}..."`);

    // Bước 2: Setup mode video x4
    log(logFile, `    Bước 2/5 → Setup mode video x4...`);
    runScript(logFile, `node "${S}\\actionMode\\setup-bot-action-mode.js" video x4`);

    // Bước 3: Click "Bắt đầu" → Popup → Chọn ảnh gen làm Start Frame
    log(logFile, `    Bước 3/5 → Chọn ảnh làm Start Frame...`);
    runScript(logFile, `node "${S}\\actionMode\\select-start-frame.js" "${genImg}"`);

    // Bước 4: Nhập prompt video và submit
    log(logFile, `    Bước 4/5 → Nhập prompt video và gửi...`);
    const safeVidPrompt = vidPromptData.promptText.replace(/"/g, '\\"');
    runScript(logFile, `node "${S}\\actionMode\\action-input-prompt.js" "${safeVidPrompt}" 70`);

    // Bước 5: Chờ video generation hoàn tất
    log(logFile, `    Bước 5/5 → Chờ video generation (tối đa ${CONFIG.VIDEO_WAIT_SEC}s)...`);
    const waitVidOut = runScript(logFile,
      `node "${S}\\actionMode\\wait-for-results.js" video ${CONFIG.VIDEO_WAIT_SEC}`,
      (CONFIG.VIDEO_WAIT_SEC + 30) * 1000
    );
    const waitVidData = parseLastJSON(waitVidOut);
    if (!waitVidData.success) {
      log(logFile, `    ⚠️ Video ${i + 1} generation timeout: ${waitVidData.error}. Bỏ qua.`);
      continue;
    }
    log(logFile, `    ✓ Video generation hoàn tất.`);

    // Tải video về máy
    const vidPrefix = `${taskName}_video${vidNum}`;
    log(logFile, `    → Tải video về máy...`);
    const dlVidOut = runScript(logFile,
      `node "${S}\\actionMode\\download-results.js" "${videoOutputDir}" "${vidPrefix}" video`
    );
    const dlVidData = parseLastJSON(dlVidOut);

    if (dlVidData.success && dlVidData.files.length > 0) {
      downloadedVideos.push(...dlVidData.files);
      log(logFile, `    ✓ Video đã lưu: ${path.basename(dlVidData.files[0])}`);
    } else {
      log(logFile, `    ⚠️ Không tải được video ${i + 1}: ${dlVidData.error || 'unknown'}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 3: CHUYỂN ẢNH GỐC → DONE
  // ─────────────────────────────────────────────────────────────
  log(logFile, `\n[PHASE 3/3] CHUYỂN ẢNH GỐC → DONE`);
  const doneImagePath = path.join(CONFIG.DONE_FOLDER, imageFile);
  fs.renameSync(imagePath, doneImagePath);
  log(logFile, `  ✓ Đã chuyển: ${imageFile} → ${CONFIG.DONE_FOLDER}`);

  // Tóm tắt task
  log(logFile, `\n  ✅ HOÀN TẤT TASK: "${taskName}"`);
  log(logFile, `     4 ảnh lưu tại  : ${imageOutputDir}`);
  log(logFile, `     Video lưu tại  : ${videoOutputDir} (${downloadedVideos.length} file)`);

  return { taskName, images: generatedImages, videos: downloadedVideos };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

function main() {
  // Đảm bảo tất cả thư mục cần thiết tồn tại
  [CONFIG.TASKS_FOLDER, CONFIG.DONE_FOLDER, CONFIG.OUTPUT_FOLDER, CONFIG.LOGS_FOLDER]
    .forEach(ensureDir);

  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(CONFIG.LOGS_FOLDER, `workflow-${today}.log`);

  log(logFile, `\n${'#'.repeat(70)}`);
  log(logFile, `## OPENCLAW VEO3 WORKFLOW KHỞI ĐỘNG`);
  log(logFile, `## ${new Date().toLocaleString('vi-VN')}`);
  log(logFile, `## Tasks  : ${CONFIG.TASKS_FOLDER}`);
  log(logFile, `## Output : ${CONFIG.OUTPUT_FOLDER}`);
  log(logFile, `## Done   : ${CONFIG.DONE_FOLDER}`);
  log(logFile, `${'#'.repeat(70)}`);

  // Quét thư mục Tasks
  let taskFiles;
  try {
    taskFiles = fs.readdirSync(CONFIG.TASKS_FOLDER)
      .filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort();
  } catch (err) {
    log(logFile, `\n❌ FATAL: Không đọc được thư mục Tasks: ${err.message}`);
    process.exit(1);
  }

  log(logFile, `\n📋 Tìm thấy ${taskFiles.length} ảnh cần xử lý:`);
  taskFiles.forEach((f, i) => log(logFile, `   ${String(i + 1).padStart(2, '0')}. ${f}`));

  if (taskFiles.length === 0) {
    log(logFile, `\n😴 Không có task nào. Kết thúc workflow.\n`);
    process.exit(0);
  }

  const summary = { success: [], failed: [] };

  for (const imageFile of taskFiles) {
    try {
      const result = processImage(imageFile, logFile);
      summary.success.push(result.taskName);
    } catch (err) {
      log(logFile, `\n❌ THẤT BẠI task "${imageFile}": ${err.message}`);
      summary.failed.push(imageFile);
    }
  }

  // Tổng kết
  log(logFile, `\n${'#'.repeat(70)}`);
  log(logFile, `## KẾT QUẢ WORKFLOW - ${new Date().toLocaleString('vi-VN')}`);
  log(logFile, `## ✅ Thành công : ${summary.success.length} task(s)`);
  if (summary.success.length > 0) {
    summary.success.forEach(t => log(logFile, `##     + ${t}`));
  }
  log(logFile, `## ❌ Thất bại  : ${summary.failed.length} task(s)`);
  if (summary.failed.length > 0) {
    summary.failed.forEach(t => log(logFile, `##     - ${t}`));
  }
  log(logFile, `${'#'.repeat(70)}\n`);

  process.exit(summary.failed.length > 0 ? 1 : 0);
}

main();
