#!/usr/bin/env node
/**
 * run-tasks.js
 * ─────────────────────────────────────────────────────────────────────
 * Đọc tasks có status=pending từ Google Sheet
 * → chạy từng lệnh tuần tự
 * → cập nhật status=done / error sau mỗi lệnh
 *
 * Cú pháp:
 *   node run-tasks.js              ← chạy tất cả pending
 *   node run-tasks.js --dry-run    ← chỉ liệt kê, không chạy
 *   node run-tasks.js --from 3     ← bắt đầu từ task thứ 3
 *   node run-tasks.js --limit 5    ← chỉ chạy tối đa 5 tasks
 * ─────────────────────────────────────────────────────────────────────
 */

const { execSync } = require('child_process');
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
// CONFIG
// ══════════════════════════════════════════════════════════════════
const WEBHOOK_URL = process.env.WEBHOOK_URL
  || 'https://script.google.com/macros/s/AKfycbzxYh83welrm_o-p5j5GNy5nAm0QsFHVMFvmgjN-PsfZjevLEWw0A9FLqS9WslHyh3j_Q/exec';

// Thời gian chờ tối đa cho 1 lệnh node (giây) — veo3-full chạy lâu
const CMD_TIMEOUT_SEC = parseInt(process.env.CMD_TIMEOUT_SEC || '3600'); // 1 tiếng

// Sleep giữa các task (giây)
const SLEEP_BETWEEN_SEC = parseInt(process.env.SLEEP_BETWEEN_SEC || '15');

// ── CLI args ─────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fromIdx = (() => { const i = args.indexOf('--from'); return i !== -1 ? parseInt(args[i+1]) - 1 : 0; })();
const limit   = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i+1]) : Infinity; })();

// ══════════════════════════════════════════════════════════════════
// TIỆN ÍCH
// ══════════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg, color = '') {
  const ts    = new Date().toTimeString().split(' ')[0];
  const reset = '\x1b[0m';
  const c     = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m' };
  console.log(`${c[color]||''}[${ts}] ${msg}${color ? reset : ''}`);
}
function logSep(title = '', char = '─') {
  console.log('\n' + char.repeat(65));
  if (title) { console.log(`  ${title}`); console.log(char.repeat(65)); }
}

// ══════════════════════════════════════════════════════════════════
// WEBHOOK — lấy pending tasks
// ══════════════════════════════════════════════════════════════════
async function fetchPendingTasks() {
  log('Lấy danh sách pending tasks từ Sheet...');
  const url = new URL(WEBHOOK_URL);
  url.searchParams.append('mode', 'get_tasks');
  url.searchParams.append('status', 'pending');

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 20000);
  const res  = await fetch(url.toString(), { signal: ctrl.signal });
  clearTimeout(tid);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'get_tasks thất bại');

  log(`✓ Tìm thấy ${data.tasks.length} pending tasks`, 'green');
  return data.tasks; // [{ row, image_path, product, context, command, status }]
}

// ══════════════════════════════════════════════════════════════════
// WEBHOOK — cập nhật status
// fields: { status, started_at, finished_at, duration_sec, error_message }
// ══════════════════════════════════════════════════════════════════
async function updateTask(row, fields = {}) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 15000);
    const res  = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'update_task', row, ...fields }),
      signal:  ctrl.signal,
    });
    clearTimeout(tid);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    log(`  ✓ Sheet row ${row} → ${fields.status || '(update)'}`,
        fields.status === 'done' ? 'green' : fields.status === 'error' ? 'red' : 'yellow');
  } catch (err) {
    log(`  ⚠️ Không cập nhật được Sheet: ${err.message}`, 'yellow');
  }
}

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}

// ══════════════════════════════════════════════════════════════════
// CHẠY 1 LỆNH
// ══════════════════════════════════════════════════════════════════
function runCommand(command) {
  log(`  → Thực thi: ${command.substring(0, 90)}...`, 'gray');
  execSync(command, {
    stdio:   'inherit',           // in thẳng stdout/stderr ra terminal
    timeout: CMD_TIMEOUT_SEC * 1000,
    shell:   true,
  });
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════
(async function main() {
  logSep('RUN-TASKS — Chạy pending tasks từ Google Sheet', '═');
  if (DRY_RUN) log('⚡ DRY RUN — chỉ liệt kê, không chạy thật', 'yellow');

  let tasks;
  try {
    tasks = await fetchPendingTasks();
  } catch (err) {
    log(`❌ Không lấy được tasks: ${err.message}`, 'red');
    log(`   Kiểm tra: (1) webhook có hỗ trợ mode=get_tasks chưa? (2) mạng ổn không?`);
    process.exit(1);
  }

  if (!tasks.length) {
    log('ℹ️  Không có pending task nào.', 'cyan');
    return;
  }

  // Áp dụng --from và --limit
  const slice  = tasks.slice(fromIdx, fromIdx + (isFinite(limit) ? limit : tasks.length));
  const total  = slice.length;
  const skipped = fromIdx;

  if (skipped) log(`  → Bỏ qua ${skipped} task đầu (--from ${fromIdx + 1})`, 'gray');

  logSep(`DANH SÁCH ${total} TASKS SẼ CHẠY`);
  slice.forEach((t, i) => {
    log(`  [${String(i+1).padStart(2,'0')}] ${t.product.toUpperCase()} | ${t.context} | ${path.basename(t.image_path || t.command.match(/"([^"]+\.(jpg|jpeg|png|webp|gif))/i)?.[1] || '')}`, 'cyan');
  });

  if (DRY_RUN) {
    logSep('DRY RUN xong — không chạy thật', '═');
    return;
  }

  logSep('BẮT ĐẦU CHẠY');

  const startAll = Date.now();
  let doneCount  = 0;
  let errorCount = 0;

  for (let i = 0; i < slice.length; i++) {
    const task = slice[i];
    const num  = `[${String(i+1).padStart(2,'0')}/${total}]`;

    logSep(`${num} ${task.product.toUpperCase()} — ${path.basename(task.image_path || '')} — context: ${task.context}`);
    log(`  Row Sheet: ${task.row}`);

    const t0 = Date.now();
    try {
      // Mark running + started_at trước khi chạy
      await updateTask(task.row, { status: 'running', started_at: nowVN() });

      runCommand(task.command);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`${num} ✅ XONG (${elapsed}s)`, 'green');
      doneCount++;
      await updateTask(task.row, {
        status:       'done',
        finished_at:  nowVN(),
        duration_sec: elapsed,
      });

    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const errMsg  = (err.message || 'unknown error').substring(0, 200);
      log(`${num} ❌ THẤT BẠI (${elapsed}s): ${errMsg}`, 'red');
      errorCount++;
      await updateTask(task.row, {
        status:        'error',
        finished_at:   nowVN(),
        duration_sec:  elapsed,
        error_message: errMsg,
      });
    }

    // Sleep trước task tiếp theo (trừ task cuối)
    if (i < slice.length - 1) {
      log(`  → Nghỉ ${SLEEP_BETWEEN_SEC}s trước task tiếp...`, 'gray');
      await sleep(SLEEP_BETWEEN_SEC * 1000);
    }
  }

  // ── Tổng kết ────────────────────────────────────────────────────
  const totalSec = ((Date.now() - startAll) / 1000 / 60).toFixed(1);
  logSep('TỔNG KẾT', '═');
  log(`  Tổng thời gian : ${totalSec} phút`);
  log(`  ✅ Done  : ${doneCount}/${total}`, doneCount === total ? 'green' : 'cyan');
  if (errorCount) log(`  ❌ Error : ${errorCount}/${total}`, 'red');
  console.log('═'.repeat(65) + '\n');

})();