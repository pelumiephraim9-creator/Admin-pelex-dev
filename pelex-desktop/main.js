// Pelex desktop: a window that opens the Pelex app. Change PELEX_URL when the site address changes.
const { app, BrowserWindow, shell } = require('electron');
const PELEX_URL = 'https://pelex.tech';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 380, minHeight: 600,
    title: 'Pelex', backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  win.loadURL(PELEX_URL);
  // Links to other websites open in the user's normal browser, not inside Pelex.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(PELEX_URL)) { e.preventDefault(); shell.openExternal(url); }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
