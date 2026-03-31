#!/usr/bin/env node
/**
 * generate-tasks.js
 * ─────────────────────────────────────────────────────────────────────
 * Quét Tasks/hat/ và Tasks/sunglasses/
 * → lấy context ngẫu nhiên từ webhook
 * → ghi thẳng lên tab "tasks" trong Google Sheet
 *
 * Tab "tasks" columns:
 *   image_path | product | context | command | status | created_at
 *
 * Duplicate logic:
 *   - status=done   → skip (giữ nguyên)
 *   - pending/error → ghi đè (reset về pending với context mới)
 *   - chưa có       → append
 *
 * Cú pháp:
 *   node generate-tasks.js "G:\My Drive\ProjectsVeo3\Tasks"
 * ─────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ── Load .env ────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// ══════════════════════════════════════════════════════════════════
// CONFIG — đọc từ .env (cùng thư mục), fallback về giá trị mặc định
// ══════════════════════════════════════════════════════════════════

const SCRIPT_PATH = process.env.SCRIPT_PATH
  || 'C:\\Users\\ADMIN\\openClawVeo3\\test-phase2.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL
  || 'https://script.google.com/macros/s/AKfycbzxYh83welrm_o-p5j5GNy5nAm0QsFHVMFvmgjN-PsfZjevLEWw0A9FLqS9WslHyh3j_Q/exec';

// PRODUCT_FOLDERS đọc từ env "hat,sunglasses" hoặc dùng mặc định
const PRODUCT_FOLDERS = (() => {
  const raw = process.env.PRODUCT_FOLDERS || 'hat,sunglasses';
  return Object.fromEntries(raw.split(',').map(p => p.trim()).filter(Boolean).map(p => [p, p]));
})();

// Fallback nếu webhook chưa có tab "context"
const FALLBACK_CONTEXTS = {
  hat:        ['instore', 'outdoor', 'lifestyle', 'studio'],
  sunglasses: ['instore', 'outdoor', 'beach', 'urban', 'studio'],
  default:    ['instore', 'outdoor', 'lifestyle'],
};

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.webp','.gif','.bmp','.tiff','.tif','.avif']);

// ══════════════════════════════════════════════════════════════════
// THAM SỐ — ưu tiên: argument CLI > .env TASKS_DIR
// ══════════════════════════════════════════════════════════════════
const TASKS_DIR = process.argv[2] || process.env.TASKS_DIR;

// ══════════════════════════════════════════════════════════════════
// TIỆN ÍCH
// ══════════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

const logLines = [];
function log(msg) {
  const ts   = new Date().toTimeString().split(' ')[0];
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logLines.push(line);
}
function logSep(title) {
  log('─'.repeat(65));
  if (title) { log(`  ${title}`); log('─'.repeat(65)); }
}
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ══════════════════════════════════════════════════════════════════
// WEBHOOK — lấy context
// ══════════════════════════════════════════════════════════════════
async function fetchContext(product) {
  try {
    const url = new URL(WEBHOOK_URL);
    url.searchParams.append('mode', 'context');
    url.searchParams.append('product', product);

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);
    const res  = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(tid);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success && data.context) {
      log(`  ✓ context [${product}]: "${data.context}" (webhook)`);
      return { context: data.context, source: 'webhook' };
    }
    throw new Error(data.error || 'không có context');

  } catch (err) {
    log(`  ⚠️ Webhook thất bại: ${err.message} → fallback`);
    const list = FALLBACK_CONTEXTS[product] || FALLBACK_CONTEXTS.default;
    const ctx  = pickRandom(list);
    log(`  → context [${product}]: "${ctx}" (fallback)`);
    return { context: ctx, source: 'fallback' };
  }
}

// ══════════════════════════════════════════════════════════════════
// WEBHOOK — ghi tasks lên Sheet
// ══════════════════════════════════════════════════════════════════
async function writeTasksToSheet(tasks) {
  log(`  → Gửi ${tasks.length} tasks lên Sheet...`);

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 30000);

  const res = await fetch(WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ mode: 'write_tasks', tasks }),
    signal:  ctrl.signal,
  });
  clearTimeout(tid);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'write_tasks thất bại');

  log(`  ✓ Sheet: ${data.added} mới | ${data.overwritten} ghi đè | ${data.skipped} skip (done)`);
  return data;
}

// ══════════════════════════════════════════════════════════════════
// QUÉT ẢNH
// ══════════════════════════════════════════════════════════════════
function scanImageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .filter(e => IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map(e => path.join(dir, e.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
}

// ══════════════════════════════════════════════════════════════════
// LOG FILE LOCAL (backup)
// ══════════════════════════════════════════════════════════════════
function writeLocalLog(absDir, tasks, sheetResult) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ds  = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const ts  = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fp  = path.join(absDir, `task-log-${ds}-${ts}.txt`);

  const byProduct = {};
  tasks.forEach(t => (byProduct[t.product] = byProduct[t.product] || []).push(t));

  const lines = [
    '═'.repeat(65),
    '  VEO3 GENERATE TASKS — LOG',
    `  ${now.toLocaleString('vi-VN')}`,
    '═'.repeat(65),
    '',
    `Tasks dir : ${absDir}`,
    `Script    : ${SCRIPT_PATH}`,
    `Total     : ${tasks.length} tasks`,
    sheetResult
      ? `Sheet     : ${sheetResult.added} mới | ${sheetResult.overwritten} ghi đè | ${sheetResult.skipped} skip`
      : `Sheet     : thất bại`,
    '',
  ];

  for (const [product, rows] of Object.entries(byProduct)) {
    lines.push(`── ${product.toUpperCase()} (${rows.length} ảnh) ${'─'.repeat(50 - product.length)}`);
    rows.forEach((r, i) => {
      lines.push(
        `  [${String(i+1).padStart(2,'0')}] ${path.basename(r.image_path).padEnd(35)}` +
        ` context="${r.context}" | ${r.source}`
      );
    });
    lines.push('');
  }

  lines.push('─'.repeat(65), '  LOG CHI TIẾT', '─'.repeat(65));
  lines.push(...logLines, '', '═'.repeat(65));

  fs.writeFileSync(fp, lines.join('\n'), 'utf8');
  return fp;
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════
(async function main() {
  console.log('\n' + '═'.repeat(65));
  console.log('  VEO3 GENERATE TASKS v3');
  console.log('  Quét ảnh → lấy context → ghi lên Google Sheet');
  console.log('═'.repeat(65));

  if (!TASKS_DIR) {
    console.error('\n❌ Thiếu tasks_dir!');
    console.error('   Cú pháp: node generate-tasks.js <tasks_dir>');
    console.error('   Ví dụ  : node generate-tasks.js "G:\\My Drive\\ProjectsVeo3\\Tasks"\n');
    process.exit(1);
  }

  const absDir = path.resolve(TASKS_DIR);
  if (!fs.existsSync(absDir)) {
    console.error(`\n❌ Thư mục không tồn tại: ${absDir}\n`);
    process.exit(1);
  }

  log(`Tasks dir : ${absDir}`);

  // ── BƯỚC 1: Quét ảnh ──────────────────────────────────────────
  logSep('BƯỚC 1: QUÉT THƯ MỤC');

  const allImages = [];
  for (const [folder, product] of Object.entries(PRODUCT_FOLDERS)) {
    const dir   = path.join(absDir, folder);
    if (!fs.existsSync(dir)) {
      log(`  ⚠️  ${folder}/ không tồn tại — bỏ qua`);
      continue;
    }
    const files = scanImageFiles(dir);
    log(`  📁 ${folder}/ → ${files.length} ảnh`);
    files.forEach((f, i) => log(`      [${i+1}] ${path.basename(f)}`));
    files.forEach(file => allImages.push({ file, product }));
  }

  if (!allImages.length) {
    console.error('\n❌ Không tìm thấy ảnh nào!');
    process.exit(1);
  }
  log(`\nTổng: ${allImages.length} ảnh`);

  // ── BƯỚC 2: Lấy context ───────────────────────────────────────
  logSep('BƯỚC 2: LẤY CONTEXT');

  // Nhóm theo product để log gọn
  const byProduct = {};
  allImages.forEach(({ file, product }) =>
    (byProduct[product] = byProduct[product] || []).push(file)
  );

  const tasks = [];
  for (const [product, files] of Object.entries(byProduct)) {
    log(`\n── ${product.toUpperCase()} (${files.length} ảnh) ──`);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      log(`  [${i+1}/${files.length}] ${path.basename(file)}`);

      const { context, source } = await fetchContext(product);
      const command = `node "${SCRIPT_PATH}" "${file}" ${product} ${context}`;

      tasks.push({ image_path: file, product, context, command, source });
      if (i < files.length - 1) await sleep(150);
    }
  }

  // ── BƯỚC 3: Ghi lên Sheet ─────────────────────────────────────
  logSep('BƯỚC 3: GHI LÊN GOOGLE SHEET');

  // Payload gửi lên — không gửi field source (internal only)
  const payload = tasks.map(({ image_path, product, context, command }) =>
    ({ image_path, product, context, command })
  );

  let sheetResult = null;
  try {
    sheetResult = await writeTasksToSheet(payload);
  } catch (err) {
    log(`  ❌ Ghi Sheet thất bại: ${err.message}`);
    log(`  → Kiểm tra: (1) đã deploy doPost chưa? (2) quyền "Anyone" chưa?`);
  }

  // ── BƯỚC 4: Log local ─────────────────────────────────────────
  logSep('BƯỚC 4: GHI LOG LOCAL');
  const logPath = writeLocalLog(absDir, tasks, sheetResult);
  log(`✓ ${path.basename(logPath)}`);

  // ── TỔNG KẾT ──────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(65));
  console.log(`  ✅ HOÀN TẤT — ${tasks.length} tasks`);
  for (const [product, files] of Object.entries(byProduct)) {
    const ctxs = [...new Set(tasks.filter(t => t.product === product).map(t => t.context))];
    console.log(`  ${product.padEnd(15)}: ${files.length} ảnh | contexts: [${ctxs.join(', ')}]`);
  }
  if (sheetResult) {
    console.log(`\n  Google Sheet:`);
    console.log(`    ✅ ${sheetResult.added} task mới`);
    if (sheetResult.overwritten) console.log(`    🔄 ${sheetResult.overwritten} ghi đè (reset pending)`);
    if (sheetResult.skipped)     console.log(`    ⏭️  ${sheetResult.skipped} skip (đã done)`);
  }
  console.log(`\n  Log: ${path.basename(logPath)}`);
  console.log('═'.repeat(65) + '\n');

})();