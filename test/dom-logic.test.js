// Browser-free contract test for the actionMode scripts.
//
// The real automation runs inside Chrome via CDP. This sandbox kills any browser
// after a few seconds, so instead of a live browser we validate the two things
// that actually break in practice:
//   1) the mock page (test/mock-labs.html) exposes exactly the DOM hooks the
//      scripts look for, and the finder logic locates them + computes click coords;
//   2) the production scripts still contain those selector literals (drift guard).
//
// Run: node test/dom-logic.test.js     (full Chrome e2e: node test/run-local-test.sh)

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${d}`); } };

// --- load mock page into jsdom, give every element a non-zero box -------------
const html = fs.readFileSync(path.join(__dirname, 'mock-labs.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://127.0.0.1/labs.google' });
const { window } = dom;
const { document } = window;

// jsdom returns all-zero rects; fake a deterministic layout so width/height > 0
let boxCounter = 0;
window.Element.prototype.getBoundingClientRect = function () {
  const i = (boxCounter++ % 20);
  const left = 50 + i * 30, top = 60 + i * 25, width = 120, height = 40;
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
};

// open the menu so mode/qty tabs are laid out (mirrors what the script does first)
document.getElementById('menuPanel').classList.add('open');

// helper: evaluate a finder expression string in the page context
const evalInPage = (expr) => window.eval(expr);

console.log('\n=== DOM contract: actionMode finders against mock-labs.html ===\n');

// 1) menu button (setup-bot-action-mode.js / check-mode.js)
const menuPos = evalInPage(`(() => {
  const btns = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
  const btn = btns.find(b => /nano banana|video|veo/i.test(b.textContent));
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
})()`);
ok('menu button found (aria-haspopup=menu, /nano banana|video|veo/)', !!menuPos);

// 2) mode tab: image (text includes "hình" + "ảnh")
const imgTab = evalInPage(`(() => {
  const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
  const btn = tabs.find(b => { const t=b.textContent.toLowerCase(); return t.includes('hình') && t.includes('ảnh'); });
  return btn ? 'ok' : null;
})()`);
ok('mode tab IMAGE found ("Hình ảnh")', !!imgTab);

// 3) mode tab: video
const vidTab = evalInPage(`(() => {
  const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
  return tabs.find(b => b.textContent.toLowerCase().includes('video')) ? 'ok' : null;
})()`);
ok('mode tab VIDEO found', !!vidTab);

// 4) quantity tabs x1/x2/x4 (exact lowercase match, as in set-quantity / setup)
for (const q of ['x1', 'x2', 'x4']) {
  const qpos = evalInPage(`(() => {
    const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
    return tabs.find(b => b.textContent.trim().toLowerCase() === '${q}') ? 'ok' : null;
  })()`);
  ok(`quantity tab ${q} found`, !!qpos);
}

// 5) slate editor (action-input-prompt.js) + placeholder text
const editorPos = evalInPage(`(() => {
  const editors = Array.from(document.querySelectorAll('div[role="textbox"][data-slate-editor="true"][contenteditable="true"]'));
  const visible = editors.filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0);
  let el = visible.find(e => { const ph = e.querySelector('[data-slate-placeholder="true"]'); return ph && (ph.textContent.includes('Bạn muốn tạo gì') || ph.textContent.toLowerCase().includes('create')); });
  if (!el && visible.length) el = visible[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height*0.7});
})()`);
ok('slate editor found via placeholder "Bạn muốn tạo gì?"', !!editorPos);

// 6) submit button: button containing <i>arrow_forward</i>, not disabled
const submitPos = evalInPage(`(() => {
  const all = Array.from(document.querySelectorAll('button'));
  const btn = all.find(b => { if (b.disabled) return false; const i = b.querySelector('i'); return i && i.textContent.trim() === 'arrow_forward'; });
  return btn ? 'ok' : null;
})()`);
ok('submit button found (<i>arrow_forward</i>)', !!submitPos);

// 7) upload "+" button: <i>add_2</i>
const addPos = evalInPage(`(() => {
  const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
  const btn = btns.find(b => { const i = b.querySelector('i'); return i && i.textContent.trim() === 'add_2'; });
  return btn ? 'ok' : null;
})()`);
ok('upload add button found (<i>add_2</i>)', !!addPos);

// 8) hidden file input (upload-image.js strategy 1)
ok('hidden input[type=file] present', !!document.querySelector('input[type="file"]'));

// --- drift guard: the selector literals must still exist in the real scripts --
console.log('\n=== Drift guard: production scripts still use these selectors ===\n');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const setup = src('actionMode/setup-bot-action-mode.js');
const input = src('actionMode/action-input-prompt.js');
const upload = src('actionMode/upload-image.js');

ok('setup uses aria-haspopup=menu',           setup.includes('aria-haspopup="menu"'));
ok('setup uses button[role="tab"]',           setup.includes('button[role="tab"]'));
ok('input uses data-slate-editor selector',   input.includes('data-slate-editor="true"'));
ok('input targets arrow_forward submit icon', input.includes('arrow_forward'));
ok('upload targets add_2 icon',               upload.includes('add_2'));
ok('upload uses input[type="file"]',          upload.includes('input[type="file"]'));

window.close();
console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
