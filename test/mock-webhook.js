// Mock Google Apps Script webhook for local testing.
// Reproduces the two response shapes the real script returns:
//   - get-random-prompt.js  -> GET ?mode=&product=&context=  => {success, prompt, mode, product, context}
//   - check-task.js         -> GET (no params)               => {success, data:{row, prompt}} | {success, data:null}
//
// Usage: node test/mock-webhook.js [port]
const http = require('http');

const PORT = parseInt(process.argv[2] || process.env.MOCK_WEBHOOK_PORT || '8124', 10);

// A tiny prompt bank keyed by product so output looks realistic.
const PROMPTS = {
  hat:        'A stylish bucket hat product shot, soft studio lighting, 4k',
  sunglasses: 'Premium sunglasses on a marble surface, cinematic reflection',
  bag:        'A leather handbag on a wooden table, warm natural light',
};

// Toggle to simulate "no task left" for check-task.js (set MOCK_NO_TASK=1)
const NO_TASK = process.env.MOCK_NO_TASK === '1';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const mode    = url.searchParams.get('mode');
  const product = url.searchParams.get('product');
  const context = url.searchParams.get('context') || '';

  res.setHeader('Content-Type', 'application/json');

  // get-random-prompt.js path (has mode + product query params)
  if (mode && product) {
    const base = PROMPTS[product] || `A high quality ${product} product image`;
    const prompt = context ? `${base} — context: ${context}` : base;
    res.end(JSON.stringify({ success: true, mode, product, context, prompt }));
    console.log(`[webhook] prompt request mode=${mode} product=${product} context="${context}"`);
    return;
  }

  // check-task.js path (no params)
  if (NO_TASK) {
    res.end(JSON.stringify({ success: true, data: null }));
    console.log('[webhook] check-task -> no task');
  } else {
    res.end(JSON.stringify({ success: true, data: { row: 7, prompt: PROMPTS.hat } }));
    console.log('[webhook] check-task -> task row 7');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[webhook] mock Google Apps Script listening on http://127.0.0.1:${PORT}`);
});
