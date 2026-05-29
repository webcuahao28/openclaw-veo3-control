// Browser-free test for the checkTasks scripts against an in-process mock of the
// Google Apps Script webhook. No external network, no browser.
//
// Run: node test/webhook.test.js

const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${d}`); } };

const BANK = { hat: 'A stylish bucket hat product shot', sunglasses: 'Premium sunglasses cinematic', bag: 'A leather handbag warm light' };

function startWebhook(opts = {}) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const mode = u.searchParams.get('mode'), product = u.searchParams.get('product'), context = u.searchParams.get('context') || '';
    res.setHeader('Content-Type', 'application/json');
    if (mode && product) {
      const base = BANK[product] || `A high quality ${product}`;
      res.end(JSON.stringify({ success: true, mode, product, context, prompt: context ? `${base} — context: ${context}` : base }));
    } else if (opts.noTask) {
      res.end(JSON.stringify({ success: true, data: null }));
    } else {
      res.end(JSON.stringify({ success: true, data: { row: 7, prompt: BANK.hat } }));
    }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

const run = (rel, args, env) => new Promise((resolve) => {
  execFile('node', [path.join(ROOT, rel), ...args], { env: { ...process.env, ...env }, timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout, stderr }));
});
const lastJson = (s) => JSON.parse(s.trim().split('\n').pop());

(async () => {
  console.log('\n=== checkTasks scripts vs in-process mock webhook ===\n');

  const srv = await startWebhook();
  const URL = `http://127.0.0.1:${srv.address().port}/`;

  // get-random-prompt.js with context
  const gp = await run('checkTasks/get-random-prompt.js', ['video', 'hat', 'in the car'], { WEBHOOK_URL: URL });
  const gpj = lastJson(gp.stdout);
  ok('get-random-prompt exits 0', gp.code === 0, `code=${gp.code}`);
  ok('get-random-prompt hasPrompt=true', gpj.hasPrompt === true);
  ok('prompt carries mode/product/context', gpj.mode === 'video' && gpj.product === 'hat' && /in the car/.test(gpj.promptText));

  // get-random-prompt.js missing args -> usage error, exit 1
  const gpMissing = await run('checkTasks/get-random-prompt.js', ['image'], { WEBHOOK_URL: URL });
  ok('get-random-prompt errors on missing product (exit 1)', gpMissing.code === 1);

  // check-task.js with a task
  const ct = await run('checkTasks/check-task.js', [], { WEBHOOK_URL: URL });
  const ctj = lastJson(ct.stdout);
  ok('check-task finds task (exit 0, hasTask)', ct.code === 0 && ctj.hasTask === true && ctj.row === 7);

  srv.close();

  // check-task.js with NO task -> exit 1, hasTask false
  const srv2 = await startWebhook({ noTask: true });
  const URL2 = `http://127.0.0.1:${srv2.address().port}/`;
  const ctNone = await run('checkTasks/check-task.js', [], { WEBHOOK_URL: URL2 });
  const ctNoneJson = lastJson(ctNone.stdout);
  ok('check-task no-task (exit 1, hasTask=false)', ctNone.code === 1 && ctNoneJson.hasTask === false);
  srv2.close();

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
