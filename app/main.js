const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const CDP = require('chrome-remote-interface');

// When packaged, scripts live in resources/; when dev, they're one level up
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath)
  : path.resolve(__dirname, '..');

const CDP_PORT = 9222;

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 500,
    height: 820,
    minWidth: 460,
    minHeight: 600,
    resizable: true,
    title: 'OpenClaw Flow Bot',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Use a generic icon fallback if no .ico
    ...(require('fs').existsSync(path.join(__dirname, 'icon.ico'))
      ? { icon: path.join(__dirname, 'icon.ico') }
      : {}),
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Helpers ────────────────────────────────────────────────────────────────

function runScript(relPath, args = [], extraEnv = {}) {
  const scriptPath = path.join(ROOT, relPath);
  const nodePath   = process.execPath; // node bundled with Electron

  return new Promise((resolve) => {
    execFile(
      nodePath,
      [scriptPath, ...args.map(String)],
      { env: { ...process.env, ...extraEnv, CDP_PORT: String(CDP_PORT) }, timeout: 90000, cwd: ROOT },
      (err, stdout, stderr) => {
        const lastLine = (stdout || '').trim().split('\n').pop();
        let jsonResult = null;
        try { jsonResult = JSON.parse(lastLine); } catch {}
        resolve({
          code: err ? (err.code || 1) : 0,
          success: !err || (jsonResult && jsonResult.success),
          stdout,
          stderr,
          json: jsonResult,
        });
      }
    );
  });
}

// ── IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('check-connection', async () => {
  try {
    const targets = await CDP.List({ port: CDP_PORT });
    const flowTab = targets.find((t) => t.url.includes('labs.google') && t.type === 'page');
    return { connected: true, hasFlowTab: !!flowTab, tabUrl: flowTab?.url || '' };
  } catch {
    return { connected: false, hasFlowTab: false, tabUrl: '' };
  }
});

ipcMain.handle('create-project', async () =>
  runScript('flowMode/create-project.js'));

ipcMain.handle('open-tab', async (_, { url }) =>
  runScript('flowMode/open-tab.js', [url || '']));

ipcMain.handle('select-options', async (_, { mode, ratio, qty, model }) =>
  runScript('flowMode/select-options.js', [mode, ratio, qty, model || '']));

ipcMain.handle('sort-assets', async (_, { sortBy }) =>
  runScript('flowMode/sort-assets.js', [sortBy]));

ipcMain.handle('click-asset', async (_, { index }) =>
  runScript('flowMode/click-asset.js', [index]));

ipcMain.handle('input-prompt', async (_, { text, paste }) =>
  runScript('flowMode/input-prompt.js', [text, paste]));

ipcMain.handle('upload-image', async (_, { imagePath }) =>
  runScript('flowMode/upload-image.js', [imagePath]));

ipcMain.handle('save-images', async (_, { outputFolder, prefix, mode, ratio }) =>
  runScript('flowMode/save-images.js', [outputFolder, prefix || '', mode || 'image', ratio || '1:1']));

// Open folder picker dialog
ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

// Open file picker dialog for images
ipcMain.handle('pick-image', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('open-folder', async (_, { folderPath }) => {
  shell.openPath(folderPath);
});
