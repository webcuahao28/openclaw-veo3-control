// Shared CDP helpers for all flowMode scripts.
const CDP = require('chrome-remote-interface');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFlowTab() {
  const targets = await CDP.List({ port: CDP_PORT });
  // Prefer project tabs, fall back to any Flow tab
  return (
    targets.find((t) => t.url.includes('labs.google') && t.url.includes('flow') && t.type === 'page') ||
    targets.find((t) => t.url.includes('labs.google') && t.type === 'page')
  );
}

async function connect() {
  const tab = await getFlowTab();
  if (!tab) throw new Error('Không tìm thấy tab labs.google/flow! Hãy mở Chrome với --remote-debugging-port=' + CDP_PORT);
  const client = await CDP({ target: tab.id, port: CDP_PORT });
  await client.Runtime.enable();
  await client.Page.enable();
  await client.DOM.enable();
  return client;
}

async function waitForElement(Runtime, expression, maxRetries = 15, delayMs = 400) {
  for (let i = 0; i < maxRetries; i++) {
    const { result } = await Runtime.evaluate({ expression, returnByValue: true });
    if (result && result.value != null) return result.value;
    await sleep(delayMs);
  }
  return null;
}

async function clickAt(Input, x, y) {
  await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
  await sleep(120);
  await Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(80);
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

// Find element by predicate expression (must return JSON {x,y} or null)
async function findAndClick(Runtime, Input, expression, label, retries = 15) {
  const pos = await waitForElement(Runtime, expression, retries, 400);
  if (!pos) throw new Error(`Không tìm thấy: ${label}`);
  const { x, y } = typeof pos === 'string' ? JSON.parse(pos) : pos;
  await clickAt(Input, x, y);
  return { x, y };
}

module.exports = { CDP_PORT, sleep, getFlowTab, connect, waitForElement, clickAt, findAndClick };
