# Local test environment — google-labs-bot

A self-contained harness for testing the OpenClaw Google Labs skill **without a
real Google account, real Google Sheet, or the live `labs.google` site**.

## What's in here

| File | Purpose |
|------|---------|
| `mock-labs.html` | A fake `labs.google` page that reproduces the exact DOM hooks the automation targets (menu button, mode/quantity tabs, Slate editor, `arrow_forward` submit, `add_2` upload button, hidden file input). It records actions to `window.__state` so tests can assert what happened. |
| `mock-webhook.js` | Stand-alone mock of the Google Apps Script webhook used by `checkTasks/*.js`. Returns the same JSON shapes as the real backend. |
| `webhook.test.js` | Browser-free test of `get-random-prompt.js` and `check-task.js` against an in-process mock webhook. |
| `dom-logic.test.js` | Browser-free contract test (jsdom) that verifies the `actionMode/*.js` element finders locate the right nodes in `mock-labs.html`, plus a drift guard that the real scripts still use those selectors. |
| `run-local-test.js` | Full end-to-end harness: serves the mock page, runs a mock webhook in-process, and drives the **real** automation scripts through Chrome over CDP, asserting the page state after each step. Connect-only (does not launch Chrome itself). |
| `run-local-test.sh` | Wrapper that launches headless Chrome, then runs `run-local-test.js`, then tears Chrome down. |

## Quick start

```bash
npm install            # chrome-remote-interface + jsdom
npm test               # runs dom-logic + webhook tests (no browser needed)
```

Individual suites:

```bash
npm run test:dom       # jsdom DOM-contract test for actionMode finders
npm run test:webhook   # checkTasks scripts vs mock webhook
```

## Full browser end-to-end

The e2e harness drives the actual scripts through a real headless Chrome:

```bash
npm run test:e2e
```

It auto-detects a Chrome binary (`CHROME_PATH`, then `.local-chrome/`, then
`google-chrome`/`chromium` on `PATH`) and launches it on CDP port `9222` — the
port the production scripts already expect.

> **Note on sandboxed CI / web sessions:** some hardened sandboxes terminate any
> long-running browser process after a few seconds. In those environments the
> e2e harness can't keep Chrome alive, so rely on `npm test` (which needs no
> browser). The e2e harness runs normally on a developer machine (Windows/macOS/
> Linux) where the bot actually operates.

## Testing the real scripts manually

Point the webhook scripts at the mock backend with the `WEBHOOK_URL` env var
(both `checkTasks` scripts honor it, falling back to the production URL):

```bash
node test/mock-webhook.js 8124 &
WEBHOOK_URL="http://127.0.0.1:8124/" node checkTasks/get-random-prompt.js video hat "in the car"
WEBHOOK_URL="http://127.0.0.1:8124/" node checkTasks/check-task.js
```
