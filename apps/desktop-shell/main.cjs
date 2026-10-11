const { app, BrowserWindow, shell, session } = require('electron');
const path = require('node:path');

const DEFAULT_STUDIO_URL = 'https://hendy-studio-web.onrender.com';
const rawStudioUrl = process.env.HENDY_STUDIO_URL || DEFAULT_STUDIO_URL;
let studioOrigin;
try {
  const parsed = new URL(rawStudioUrl);
  if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('Production desktop app requires an HTTPS HENDY_STUDIO_URL');
  }
  studioOrigin = parsed.origin;
} catch (error) {
  console.error('Invalid HENDY_STUDIO_URL:', error.message);
  app.exit(1);
}

function isTrusted(url) {
  try { return new URL(url).origin === studioOrigin; } catch { return false; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Hendy Studio Pro',
    backgroundColor: '#080b12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrusted(url)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isTrusted(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.loadURL(rawStudioUrl).catch(error => console.error('Could not load Studio:', error.message));
  if (process.env.HENDY_DESKTOP_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  app.setAppUserModelId('net.hendystudio.pro');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('will-navigate', (event, url) => { if (!isTrusted(url)) event.preventDefault(); });
});
