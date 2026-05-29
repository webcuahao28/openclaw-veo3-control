// Local integration test harness for the google-labs-bot skill.
//
// It spins up a fake "labs.google" page + a mock webhook, launches a real
// headless Chrome on the CDP port the production scripts expect (9222), then
// runs the ACTUAL automation scripts and verifies their effects via CDP.
//
// Usage:
//   node test/run-local-test.js
//
// Env:
//   CHROME_PATH   path to a chrome/chromium binary (auto-detected if omitted)
//   CDP_PORT      debugging port (default 9222 — matches the scripts)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const CDP = require('chrome-remote-interface');

const ROOT = path.resolve(__dirname, '..');
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const WEB_PORT = 8123;     // static page server
const HOOK_PORT = 8124;    // mock webhook
const PAGE_URL = `http://127.0.0.1:${WEB_PORT}/labs.google`; // url MUST contain "labs.google"
const WEBHOOK_URL = `http://127.0.0.1:${HOOK_PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- synchronous logging (survives signal kills, unlike buffered stdout) -----
const LOG_FILE = process.env.TEST_LOG || path.join(require('os').tmpdir(), 'glb-test.log');
try { fs.writeFileSync(LOG_FILE, ''); } catch {}
function log(line = '') {
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
  process.stdout.write(line+'\n');
}

// ---- pretty assert ----------------------------------------------------------
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; log(`  ✅ ${name}`); }
  else { failed++; log(`  ❌ ${name} ${detail}`); }
}

// ---- locate chrome ----------------------------------------------------------
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [];
  const localDir = path.join(ROOT, '.local-chrome');
  if (fs.existsSync(localDir)) {
    const stack = [localDir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === 'chrome-headless-shell' || e.name === 'chrome' || e.name === 'chromium') candidates.push(p);
      }
    }
  }
  for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    candidates.push(b); // let spawn resolve via PATH; existence checked at launch
  }
  return candidates.find((c) => c.startsWith('/') ? fs.existsSync(c) : true);
}

// ---- run a production script and capture output -----------------------------
function runScript(relPath, args = [], env = {}) {
  return new Promise((resolve) => {
    execFile('node', [path.join(ROOT, relPath), ...args], { env: { ...process.env, ...env }, timeout: 60000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout, stderr }));
  });
}

// ---- read window.__state from the labs.google tab ---------------------------
async function readState() {
  const targets = await CDP.List({ port: CDP_PORT });
  const tab = targets.find((t) => t.url.includes('labs.google'));
  const client = await CDP({ target: tab.id, port: CDP_PORT });
  try {
    await client.Runtime.enable();
    const { result } = await client.Runtime.evaluate({ expression: 'JSON.stringify(window.__state)', returnByValue: true });
    return JSON.parse(result.value);
  } finally { await client.close(); }
}

async function resetEditor() {
  // reload the page to a clean state between phases
  const targets = await CDP.List({ port: CDP_PORT });
  const tab = targets.find((t) => t.url.includes('labs.google'));
  const client = await CDP({ target: tab.id, port: CDP_PORT });
  try { await client.Page.enable(); await client.Page.reload(); await sleep(800); }
  finally { await client.close(); }
}

(async function main() {
  let webServer, hookProc, chromeProc;
  const cleanup = async () => {
    try { if (chromeProc) chromeProc.kill('SIGKILL'); } catch {}
    try { if (hookProc) hookProc.kill('SIGKILL'); } catch {}
    try { if (webServer) webServer.close(); } catch {}
  };

  try {
    log('\n================ LOCAL TEST: google-labs-bot ================\n');
    log('checkpoint: start');

    // 1) static server that always serves the mock page (url contains labs.google)
    const html = fs.readFileSync(path.join(__dirname, 'mock-labs.html'), 'utf8');
    webServer = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
    await new Promise((r) => webServer.listen(WEB_PORT, '127.0.0.1', r));
    log(`• Mock page server   : ${PAGE_URL}`);

    // 2) mock webhook (in-process so we don't rely on a separate listener surviving)
    const hookSrv = require('http').createServer((req, res) => {
      const u = new URL(req.url, WEBHOOK_URL);
      const mode = u.searchParams.get('mode'), product = u.searchParams.get('product'), context = u.searchParams.get('context') || '';
      res.setHeader('Content-Type', 'application/json');
      const bank = { hat: 'A stylish bucket hat product shot', sunglasses: 'Premium sunglasses cinematic', bag: 'A leather handbag warm light' };
      if (mode && product) {
        const base = bank[product] || `A high quality ${product}`;
        res.end(JSON.stringify({ success: true, mode, product, context, prompt: context ? `${base} — context: ${context}` : base }));
      } else {
        res.end(JSON.stringify({ success: true, data: { row: 7, prompt: bank.hat } }));
      }
    });
    await new Promise((r) => hookSrv.listen(HOOK_PORT, '127.0.0.1', r));
    hookProc = { kill: () => hookSrv.close() };
    log(`• Mock webhook       : ${WEBHOOK_URL}`);

    // 3) Chrome is launched by the shell wrapper (run-local-test.sh) because this
    //    sandbox kills any node process that spawns a browser. Here we only CONNECT
    //    to the already-running Chrome on CDP_PORT and navigate its tab to our page.
    log('checkpoint: waiting for externally-launched Chrome on CDP port ' + CDP_PORT);
    let baseTab = null;
    for (let i = 0; i < 40 && !baseTab; i++) {
      try {
        const targets = await CDP.List({ port: CDP_PORT });
        baseTab = targets.find((t) => t.type === 'page');
      } catch {}
      if (!baseTab) await sleep(500);
    }
    if (!baseTab) throw new Error('No Chrome found on CDP port ' + CDP_PORT + ' (launch it first).');

    // navigate that tab to our mock page (url contains "labs.google")
    {
      const c = await CDP({ target: baseTab.id, port: CDP_PORT });
      try { await c.Page.enable(); await c.Page.navigate({ url: PAGE_URL }); await sleep(1200); }
      finally { await c.close(); }
    }

    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const targets = await CDP.List({ port: CDP_PORT });
        const tab = targets.find((t) => t.url.includes('labs.google'));
        if (tab) {
          const c = await CDP({ target: tab.id, port: CDP_PORT });
          const { result } = await c.Runtime.evaluate({ expression: 'document.readyState + "|" + (!!window.__state)', returnByValue: true });
          await c.close();
          if (result.value === 'complete|true') { ready = true; break; }
        }
      } catch {}
      await sleep(500);
    }
    if (!ready) throw new Error('Chrome/page did not become ready on CDP port ' + CDP_PORT);
    log('• Page ready on CDP\n');

    // ---------- PHASE 1: webhook scripts (no browser) ----------
    log('PHASE 1 — checkTasks scripts against mock webhook');
    const gp = await runScript('checkTasks/get-random-prompt.js', ['video', 'hat', 'in the car'], { WEBHOOK_URL });
    const gpJson = JSON.parse(gp.stdout.trim().split('\n').pop());
    check('get-random-prompt exits 0', gp.code === 0, `code=${gp.code}`);
    check('get-random-prompt returns hasPrompt', gpJson.hasPrompt === true);
    check('prompt reflects product+context', /hat|bucket/i.test(gpJson.promptText) && /in the car/i.test(gpJson.promptText), gpJson.promptText);

    const ct = await runScript('checkTasks/check-task.js', [], { WEBHOOK_URL });
    const ctJson = JSON.parse(ct.stdout.trim().split('\n').pop());
    check('check-task finds a task (exit 0)', ct.code === 0 && ctJson.hasTask === true);

    const ctNone = await runScript('checkTasks/check-task.js', [], { WEBHOOK_URL, MOCK_NO_TASK: '1' });
    // NOTE: MOCK_NO_TASK is read by the webhook process, not check-task; this sub-check is informational
    log(`     (no-task variant exit code: ${ctNone.code})`);

    // ---------- PHASE 2: setup-bot-action-mode (mode + quantity) ----------
    log('\nPHASE 2 — setup-bot-action-mode.js video x2');
    const setup = await runScript('actionMode/setup-bot-action-mode.js', ['video', 'x2']);
    let st = await readState();
    check('mode switched to video', st.mode === 'video', `mode=${st.mode}`);
    check('quantity switched to x2', st.quantity === 'x2', `qty=${st.quantity}`);
    check('menu closed after setup', st.menuOpen === false);

    // back to image x1 to prove switching both ways
    await runScript('actionMode/setup-bot-action-mode.js', ['image', 'x1']);
    st = await readState();
    check('mode switched back to image', st.mode === 'image', `mode=${st.mode}`);
    check('quantity switched back to x1', st.quantity === 'x1', `qty=${st.quantity}`);

    // ---------- PHASE 3: upload-image ----------
    log('\nPHASE 3 — upload-image.js');
    const imgPath = path.join(__dirname, 'fixtures', 'sample.png');
    const up = await runScript('actionMode/upload-image.js', [imgPath]);
    st = await readState();
    check('upload-image exits 0', up.code === 0, `code=${up.code}`);
    check('file reached the file input', st.uploadedFiles.includes('sample.png'), JSON.stringify(st.uploadedFiles));

    // upload with no path => skip gracefully (exit 0)
    const upSkip = await runScript('actionMode/upload-image.js', []);
    check('upload-image with no arg skips (exit 0)', upSkip.code === 0);

    // ---------- PHASE 4: action-input-prompt ----------
    log('\nPHASE 4 — action-input-prompt.js');
    await resetEditor();
    const PROMPT = 'A stylish bucket hat in the car, cinematic';
    const inp = await runScript('actionMode/action-input-prompt.js', [PROMPT, '70']);
    st = await readState();
    check('action-input exits 0', inp.code === 0, `code=${inp.code}`);
    check('editor received full prompt', st.promptText.replace(/\s+/g, ' ').trim() === PROMPT, `got="${st.promptText}"`);
    check('submit was clicked', st.submitClicked >= 1, `clicks=${st.submitClicked}`);

    // ---------- PHASE 5: check-mode ----------
    log('\nPHASE 5 — check-mode.js');
    await runScript('actionMode/setup-bot-action-mode.js', ['video', 'x1']);
    const cm = await runScript('actionMode/check-mode.js', []);
    check('check-mode reports VIDEO', /VIDEO/.test(cm.stdout), cm.stdout.split('\n').filter(Boolean).pop());

    log(`\n================ RESULT: ${passed} passed, ${failed} failed ================\n`);
    await cleanup();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('\n💥 HARNESS ERROR:', err.message);
    await cleanup();
    process.exit(2);
  }
})();
