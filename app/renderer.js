// renderer.js — UI logic for the OpenClaw Flow Bot window

const api = window.api;

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  mode:  'image',
  ratio: '1:1',
  qty:   '2',
  sort:  'recent',
  paste: '60',
  lastSaveFolder: '',
};

// ── Log helper ───────────────────────────────────────────────────────────────
function log(msg, type = 'normal') {
  const el  = document.getElementById('log-text');
  const sp  = document.getElementById('spinner');
  el.textContent = msg;
  el.className = type;  // 'ok' | 'err' | 'busy' | 'normal'
  sp.classList.toggle('hidden', type !== 'busy');
}

// ── Connection badge ─────────────────────────────────────────────────────────
async function checkConnection() {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  dot.className = 'warn'; label.textContent = 'Đang kiểm tra...';
  try {
    const r = await api.checkConnection();
    if (!r.connected) {
      dot.className = ''; label.textContent = 'Chrome chưa mở (port 9222)';
    } else if (!r.hasFlowTab) {
      dot.className = 'warn'; label.textContent = 'Chưa có tab Flow';
    } else {
      dot.className = 'ok'; label.textContent = 'Đã kết nối ✓';
    }
  } catch {
    dot.className = ''; label.textContent = 'Lỗi kết nối';
  }
}
document.getElementById('btn-refresh').addEventListener('click', checkConnection);
checkConnection();
setInterval(checkConnection, 15000);

// ── Collapsible cards ────────────────────────────────────────────────────────
document.querySelectorAll('.card-header').forEach((hdr) => {
  hdr.addEventListener('click', () => {
    const bodyId = hdr.getAttribute('data-target');
    const body   = document.getElementById(bodyId);
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    hdr.classList.toggle('open', !isOpen);
  });
});

// ── Segmented controls ────────────────────────────────────────────────────────
function initSeg(segId, stateKey) {
  const seg = document.getElementById(segId);
  if (!seg) return;
  seg.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state[stateKey] = btn.getAttribute('data-val');
    });
  });
}
initSeg('seg-mode',  'mode');
initSeg('seg-ratio', 'ratio');
initSeg('seg-qty',   'qty');
initSeg('seg-sort',  'sort');
initSeg('seg-paste', 'paste');

// ── Generic action runner ────────────────────────────────────────────────────
async function runAction(btnId, fn) {
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '⏳ Đang chạy...';
  log('Đang thực hiện...', 'busy');
  try {
    const res = await fn();
    if (res.success === false || res.code !== 0) {
      const errMsg = res.json?.error || res.stderr || 'Thất bại';
      log('❌ ' + errMsg, 'err');
    } else {
      const okMsg = res.json?.message || res.json?.folder || '✅ Hoàn tất!';
      log(typeof okMsg === 'string' ? okMsg : '✅ Hoàn tất!', 'ok');
    }
    return res;
  } catch (err) {
    log('❌ ' + err.message, 'err');
    return { success: false };
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    checkConnection();
  }
}

// ── Action bindings ──────────────────────────────────────────────────────────

// 1. Create project
document.getElementById('btn-create-project').addEventListener('click', () =>
  runAction('btn-create-project', () => api.createProject()));

// 2. Open tab
document.getElementById('btn-open-tab').addEventListener('click', () =>
  runAction('btn-open-tab', () => api.openTab({ url: document.getElementById('tab-url').value.trim() })));

// 3. Select options
document.getElementById('btn-select-options').addEventListener('click', () =>
  runAction('btn-select-options', () => api.selectOptions({
    mode:  state.mode,
    ratio: state.ratio,
    qty:   state.qty,
    model: document.getElementById('opt-model').value.trim(),
  })));

// 4. Sort
document.getElementById('btn-sort').addEventListener('click', () =>
  runAction('btn-sort', () => api.sortAssets({ sortBy: state.sort })));

// 5. Click asset
document.getElementById('btn-click-asset').addEventListener('click', () =>
  runAction('btn-click-asset', () => api.clickAsset({
    index: parseInt(document.getElementById('click-index').value, 10) || 0,
  })));

// 6. Input prompt
document.getElementById('btn-prompt').addEventListener('click', () => {
  const text = document.getElementById('prompt-text').value.trim();
  if (!text) { log('⚠️ Hãy nhập nội dung prompt!', 'err'); return; }
  runAction('btn-prompt', () => api.inputPrompt({ text, paste: parseInt(state.paste, 10) }));
});

// 7a. Pick image file
document.getElementById('btn-pick-image').addEventListener('click', async () => {
  const p = await api.pickImage();
  if (p) document.getElementById('upload-path').value = p;
});

// 7a. Upload image
document.getElementById('btn-upload').addEventListener('click', () => {
  const imagePath = document.getElementById('upload-path').value.trim();
  if (!imagePath) { log('⚠️ Chưa chọn file ảnh!', 'err'); return; }
  runAction('btn-upload', () => api.uploadImage({ imagePath }));
});

// 7b. Pick output folder
document.getElementById('btn-pick-folder').addEventListener('click', async () => {
  const p = await api.pickFolder();
  if (p) document.getElementById('save-folder').value = p;
});

// 7b. Save images
document.getElementById('btn-save').addEventListener('click', async () => {
  const outputFolder = document.getElementById('save-folder').value.trim();
  if (!outputFolder) { log('⚠️ Chưa chọn thư mục lưu!', 'err'); return; }
  const res = await runAction('btn-save', () => api.saveImages({
    outputFolder,
    prefix: document.getElementById('save-prefix').value.trim(),
    mode:  state.mode,
    ratio: state.ratio,
  }));
  if (res?.json?.folder) {
    state.lastSaveFolder = res.json.folder;
    const openBtn = document.getElementById('btn-open-folder');
    openBtn.style.display = '';
    log(`✅ Đã lưu ${res.json.saved} ảnh → ${res.json.folder}`, 'ok');
  }
});

// 7b. Open saved folder
document.getElementById('btn-open-folder').addEventListener('click', () => {
  if (state.lastSaveFolder) api.openFolder({ folderPath: state.lastSaveFolder });
});
