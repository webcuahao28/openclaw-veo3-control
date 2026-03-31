#!/usr/bin/env node
/**
 * test-skill.js — Test runner cho skill veo3-task-csv
 * Chạy: node test-skill.js
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[1m${s}\x1b[0m`;

let passed = 0, failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(G('  ✅ PASS') + `  ${name}`);
    passed++;
  } catch (err) {
    console.log(R('  ❌ FAIL') + `  ${name}`);
    console.log(`       ${Y(err.message)}`);
    failed++;
  }
}

// ── Tải module với mock fetch dạng literal string ─────────────────
function loadModule(fetchImpl = '') {
  const candidates = [
    path.join(__dirname, 'generate-tasks.js'),
    path.join(__dirname, 'veo3-task-csv', 'generate-tasks.js'),
  ];
  let src = '';
  for (const p of candidates) {
    if (fs.existsSync(p)) { src = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!src) throw new Error('generate-tasks.js không tìm thấy');

  src = src.replace(/^#!.*\n/, '');
  src = src.replace(/\(\s*async\s+function\s+main[\s\S]*$/, '// [main removed]');

  const full = fetchImpl + '\n' + src + '\nmodule.exports={fetchContext,writeTasksToSheet,scanImageFiles,writeLocalLog};';
  const tmp = path.join(os.tmpdir(), `veo3test-${Date.now()}.js`);
  fs.writeFileSync(tmp, full);
  try { return require(tmp); }
  finally { try { fs.unlinkSync(tmp); } catch(_) {} }
}

// ── Fetch mocks ──────────────────────────────────────────────────
function fetchOk(data) {
  const d = JSON.stringify(data);
  return `const fetch=async()=>({ok:true,status:200,json:async()=>(${d})});`;
}
function fetchFail() {
  return `const fetch=async()=>{throw new Error('Network error');};`;
}
function fetchHttp(status) {
  return `const fetch=async()=>({ok:false,status:${status}});`;
}
function fetchSmart(getData, postData) {
  const g = JSON.stringify(getData);
  const p = JSON.stringify(postData);
  return `const fetch=async(url,opts)=>{
    if(opts&&opts.method==='POST') return {ok:true,status:200,json:async()=>(${p})};
    return {ok:true,status:200,json:async()=>(${g})};
  };`;
}

// ══════════════════════════════════════════════════════════════════
(async () => {
  console.log('\n' + B('═'.repeat(60)));
  console.log(B('  VEO3 SKILL TEST RUNNER'));
  console.log(B('═'.repeat(60)) + '\n');

  // T1
  await runTest('T1  fetchContext → webhook OK → trả context + source=webhook', async () => {
    const mod = loadModule(fetchOk({ success: true, context: 'beach' }));
    const r = await mod.fetchContext('sunglasses');
    assert.strictEqual(r.context, 'beach');
    assert.strictEqual(r.source, 'webhook');
  });

  // T2
  await runTest('T2  fetchContext → network error → fallback hoạt động', async () => {
    const mod = loadModule(fetchFail());
    const r = await mod.fetchContext('hat');
    assert.strictEqual(r.source, 'fallback');
    const valid = ['instore','outdoor','lifestyle','studio'];
    assert.ok(valid.includes(r.context), `context "${r.context}" phải trong [${valid}]`);
  });

  // T3
  await runTest('T3  fetchContext → success=false → fallback', async () => {
    const mod = loadModule(fetchOk({ success: false, error: 'no data' }));
    const r = await mod.fetchContext('sunglasses');
    assert.strictEqual(r.source, 'fallback');
    assert.ok(r.context, 'context phải có giá trị');
  });

  // T4
  await runTest('T4  writeTasksToSheet → server trả added=3 skipped=1', async () => {
    const mod = loadModule(fetchOk({ success: true, added: 3, overwritten: 0, skipped: 1 }));
    const tasks = [
      {image_path:'A.jpg',product:'hat',       context:'instore',command:'node x'},
      {image_path:'B.jpg',product:'hat',       context:'outdoor',command:'node x'},
      {image_path:'C.jpg',product:'sunglasses',context:'beach',  command:'node x'},
      {image_path:'D.jpg',product:'sunglasses',context:'urban',  command:'node x'},
    ];
    const r = await mod.writeTasksToSheet(tasks);
    assert.strictEqual(r.added, 3);
    assert.strictEqual(r.skipped, 1);
  });

  // T5
  await runTest('T5  writeTasksToSheet → HTTP 500 → throw error', async () => {
    const mod = loadModule(fetchHttp(500));
    await assert.rejects(
      () => mod.writeTasksToSheet([{image_path:'x.jpg',product:'hat',context:'instore',command:''}]),
      /HTTP 500/
    );
  });

  // T6
  await runTest('T6  writeTasksToSheet → success=false → throw error', async () => {
    const mod = loadModule(fetchOk({ success: false, error: 'Sheet bi khoa' }));
    await assert.rejects(
      () => mod.writeTasksToSheet([{image_path:'x.jpg',product:'hat',context:'instore',command:''}]),
      /Sheet bi khoa/
    );
  });

  // T7
  await runTest('T7  scanImageFiles → chỉ lấy ảnh, bỏ non-image & hidden', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-t7-'));
    ['a.jpg','b.png','c.webp','d.txt','e.mp4','.hidden.jpg'].forEach(f =>
      fs.writeFileSync(path.join(tmpDir, f), ''));

    const mod = loadModule();
    const files = mod.scanImageFiles(tmpDir);

    assert.strictEqual(files.length, 3, `Cần 3 ảnh, nhận ${files.length}`);
    assert.ok(files.every(f => /\.(jpg|jpeg|png|webp|gif|bmp|tiff|tif|avif)$/i.test(f)));
    assert.ok(!files.some(f => path.basename(f).startsWith('.')));
    fs.rmSync(tmpDir, { recursive: true });
  });

  // T8
  await runTest('T8  scanImageFiles → thư mục không tồn tại → []', async () => {
    const mod = loadModule();
    assert.deepStrictEqual(mod.scanImageFiles('/tmp/nonexistent-veo3-xyz'), []);
  });

  // T9
  await runTest('T9  scanImageFiles → thư mục rỗng → []', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-t9-'));
    const mod = loadModule();
    assert.deepStrictEqual(mod.scanImageFiles(tmpDir), []);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // T10
  await runTest('T10 writeLocalLog → tạo file, đủ sections', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-t10-'));
    const mod = loadModule();
    const tasks = [
      {image_path: path.join(tmpDir,'a.jpg'), product:'hat',        context:'instore',  source:'webhook'},
      {image_path: path.join(tmpDir,'b.jpg'), product:'sunglasses', context:'beach',    source:'fallback'},
    ];
    const logPath = mod.writeLocalLog(tmpDir, tasks, {added:2, overwritten:0, skipped:0});
    assert.ok(fs.existsSync(logPath));
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('VEO3 GENERATE TASKS'));
    assert.ok(content.includes('HAT'));
    assert.ok(content.includes('SUNGLASSES'));
    assert.ok(content.includes('instore'));
    assert.ok(content.includes('2 mới'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  // T11 — Integration
  await runTest('T11 Integration → scan + context + writeSheet + log', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-t11-'));
    const hatDir = path.join(tmpDir, 'hat');
    const sgDir  = path.join(tmpDir, 'sunglasses');
    fs.mkdirSync(hatDir); fs.mkdirSync(sgDir);
    ['hat1.jpg','hat2.png'].forEach(f => fs.writeFileSync(path.join(hatDir, f), ''));
    ['sg1.webp']           .forEach(f => fs.writeFileSync(path.join(sgDir,  f), ''));

    const mod = loadModule(fetchSmart(
      { success: true, context: 'outdoor' },
      { success: true, added: 3, overwritten: 0, skipped: 0 }
    ));

    const hatFiles = mod.scanImageFiles(hatDir);
    const sgFiles  = mod.scanImageFiles(sgDir);
    assert.strictEqual(hatFiles.length, 2);
    assert.strictEqual(sgFiles.length,  1);

    const tasks = [];
    for (const f of [...hatFiles, ...sgFiles]) {
      const product = hatFiles.includes(f) ? 'hat' : 'sunglasses';
      const {context, source} = await mod.fetchContext(product);
      tasks.push({image_path:f, product, context, source, command:`node x "${f}"`});
    }
    assert.strictEqual(tasks.length, 3);
    assert.ok(tasks.every(t => t.context === 'outdoor'), 'Mọi context phải là outdoor (mock)');

    const payload = tasks.map(({image_path,product,context,command}) => ({image_path,product,context,command}));
    const result  = await mod.writeTasksToSheet(payload);
    assert.strictEqual(result.added, 3);

    const logPath = mod.writeLocalLog(tmpDir, tasks, result);
    assert.ok(fs.existsSync(logPath));

    fs.rmSync(tmpDir, { recursive: true });
  });

  // ── Summary ──────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n' + B('═'.repeat(60)));
  console.log(B(`  KẾT QUẢ: ${passed}/${total} test passed`));
  if (failed > 0) {
    console.log(R(`  ❌ ${failed} test FAILED`));
  } else {
    console.log(G(`  ✅ Tất cả test đều pass!`));
  }
  console.log(B('═'.repeat(60)) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})();
