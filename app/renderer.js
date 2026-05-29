const api = window.api;

// ── State ────────────────────────────────────────────────────────────────────
const S = { mode: 'image', ratio: '1:1', qty: '2', paste: '60', lastOutFolder: '' };

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function log(msg, type = '') {
  const el = $('log-strip');
  el.textContent = msg;
  el.className = type;
}

function setStep(id, state, status = '') {
  const el = $('step-' + id);
  const st = $('st-' + id);
  el.className = 'step-item ' + state;
  if (state === 'active') {
    st.innerHTML = '<span class="spinner-sm"></span>';
  } else {
    st.textContent = status || { done: '✅', skip: '—', err: '❌', '': 'chờ' }[state] || 'chờ';
  }
}

function resetSteps() {
  ['create','options','upload','prompt','wait','save'].forEach(id => setStep(id, ''));
}

// ── Connection ───────────────────────────────────────────────────────────────
async function checkConn() {
  const dot = $('conn-dot'), lbl = $('conn-label');
  try {
    const r = await api.checkConnection();
    if (!r.connected)      { dot.className = '';     lbl.textContent = 'Chrome chưa mở'; }
    else if (!r.hasFlowTab){ dot.className = 'warn'; lbl.textContent = 'Chưa có tab Flow'; }
    else                   { dot.className = 'ok';   lbl.textContent = 'Đã kết nối ✓'; }
  } catch { dot.className = ''; lbl.textContent = 'Lỗi'; }
}
$('btn-refresh').addEventListener('click', checkConn);
$('btn-launch-chrome').addEventListener('click', () => api.launchChrome());
checkConn();
setInterval(checkConn, 12000);

// ── Collapsible groups ───────────────────────────────────────────────────────
document.querySelectorAll('.cfg-title').forEach(h => {
  h.addEventListener('click', () => {
    const body = $(h.dataset.t);
    const open = body.classList.contains('open');
    body.classList.toggle('open', !open);
    h.classList.toggle('open', !open);
  });
});

// ── Segmented controls ────────────────────────────────────────────────────────
function initSeg(id, key) {
  const seg = $(id); if (!seg) return;
  seg.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S[key] = b.dataset.v;
    });
  });
}
initSeg('seg-mode',  'mode');
initSeg('seg-ratio', 'ratio');
initSeg('seg-qty',   'qty');
initSeg('seg-paste', 'paste');

// ── File pickers ─────────────────────────────────────────────────────────────
$('btn-pick-image').addEventListener('click', async () => {
  const p = await api.pickImage(); if (p) $('upload-path').value = p;
});
$('btn-pick-folder').addEventListener('click', async () => {
  const p = await api.pickFolder(); if (p) $('save-folder').value = p;
});

// ── RUN ALL ──────────────────────────────────────────────────────────────────
$('btn-run-all').addEventListener('click', runAll);

async function runAll() {
  const btn = $('btn-run-all');
  btn.disabled = true;
  btn.textContent = '⏳  Đang chạy...';
  btn.classList.add('running');
  $('btn-open-out').style.display = 'none';
  resetSteps();
  log('Bắt đầu workflow...', 'busy');

  const promptText   = $('prompt-text').value.trim();
  const imagePath    = $('upload-path').value.trim();
  const saveFolder   = $('save-folder').value.trim();
  const savePrefix   = $('save-prefix').value.trim();
  const model        = $('opt-model').value.trim();
  const waitSec      = Math.max(5, parseInt($('wait-gen').value, 10) || 15);
  const doCreate     = $('chk-create').checked;
  const doSort       = $('chk-sort').checked;
  const doSave       = $('chk-save').checked;

  if (!promptText) { log('⚠️ Hãy nhập nội dung Prompt!', 'err'); finish(btn, false); return; }

  let lastFolder = '';

  try {
    // ── STEP 1: Tạo dự án mới ──────────────────────────────────────────────
    if (doCreate) {
      setStep('create', 'active'); log('Đang tạo dự án mới...', 'busy');
      const r = await api.createProject();
      if (!r.success && r.code !== 0) { setStep('create', 'err', r.json?.error); log('❌ Tạo dự án thất bại: ' + (r.json?.error || ''), 'err'); finish(btn, false); return; }
      setStep('create', 'done');
      await sleep(500);
    } else {
      setStep('create', 'skip');
    }

    // ── STEP 2: Chọn cài đặt ───────────────────────────────────────────────
    setStep('options', 'active'); log('Đang áp dụng cài đặt...', 'busy');
    const rOpt = await api.selectOptions({ mode: S.mode, ratio: S.ratio, qty: S.qty, model });
    if (!rOpt.success && rOpt.code !== 0) { setStep('options', 'err'); log('❌ Lỗi cài đặt: ' + (rOpt.json?.error || ''), 'err'); finish(btn, false); return; }
    setStep('options', 'done', `${S.mode} · ${S.ratio} · x${S.qty}`);
    await sleep(400);

    // ── STEP 3: Upload ảnh ─────────────────────────────────────────────────
    if (imagePath) {
      setStep('upload', 'active'); log('Đang upload ảnh tham chiếu...', 'busy');
      const rUp = await api.uploadImage({ imagePath });
      if (!rUp.success && rUp.code !== 0) { setStep('upload', 'err'); log('❌ Upload thất bại: ' + (rUp.json?.error || ''), 'err'); finish(btn, false); return; }
      setStep('upload', 'done');
      await sleep(400);
    } else {
      setStep('upload', 'skip');
    }

    // ── STEP 4: Nhập prompt & submit ───────────────────────────────────────
    setStep('prompt', 'active'); log('Đang nhập prompt...', 'busy');
    const rPr = await api.inputPrompt({ text: promptText, paste: parseInt(S.paste, 10) });
    if (!rPr.success && rPr.code !== 0) { setStep('prompt', 'err'); log('❌ Nhập prompt thất bại: ' + (rPr.json?.error || ''), 'err'); finish(btn, false); return; }
    setStep('prompt', 'done');

    // ── STEP 5: Chờ AI generate ────────────────────────────────────────────
    setStep('wait', 'active'); log(`Đang chờ AI tạo ảnh (${waitSec}s)...`, 'busy');
    for (let i = waitSec; i > 0; i--) {
      $('st-wait').innerHTML = `<span class="spinner-sm"></span> ${i}s`;
      await sleep(1000);
    }
    setStep('wait', 'done', `${waitSec}s`);

    // ── STEP 6: Lưu ảnh ───────────────────────────────────────────────────
    if (doSave && saveFolder) {
      setStep('save', 'active'); log('Đang lưu ảnh...', 'busy');
      const rSv = await api.saveImages({ outputFolder: saveFolder, prefix: savePrefix, mode: S.mode, ratio: S.ratio });
      if (rSv.json?.folder) lastFolder = rSv.json.folder;
      if (!rSv.success && rSv.code !== 0) {
        setStep('save', 'err'); log('⚠️ Lưu ảnh có lỗi: ' + (rSv.json?.error || ''), 'err');
      } else {
        setStep('save', 'done', `${rSv.json?.saved ?? '?'} ảnh`);
        log(`✅ Xong! Đã lưu ${rSv.json?.saved ?? '?'} ảnh vào ${lastFolder}`, 'ok');
      }
    } else {
      setStep('save', 'skip');
      log('✅ Workflow hoàn tất! (không lưu ảnh)', 'ok');
    }

    // ── Sort tài sản (bonus) ───────────────────────────────────────────────
    if (doSort) { await api.sortAssets({ sortBy: 'recent' }); }

    // Show open-folder button
    if (lastFolder) {
      S.lastOutFolder = lastFolder;
      const ob = $('btn-open-out');
      ob.textContent = '📂 Mở thư mục: ' + lastFolder.split(/[\\/]/).pop();
      ob.style.display = '';
    }

  } catch (err) {
    log('❌ Lỗi không mong muốn: ' + err.message, 'err');
  }

  finish(btn, true);
  checkConn();
}

function finish(btn, ok) {
  btn.disabled = false;
  btn.textContent = '▶  CHẠY TOÀN BỘ';
  btn.classList.remove('running');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Open output folder ────────────────────────────────────────────────────────
$('btn-open-out').addEventListener('click', () => {
  if (S.lastOutFolder) api.openFolder({ folderPath: S.lastOutFolder });
});
