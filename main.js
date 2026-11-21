const { app, BrowserWindow, Menu, session, WebContentsView } = require('electron');
const path = require('node:path');
const { createBrowser } = require('./browser');

const TOOLBAR_HEIGHT = 88;
const sandboxed = { nodeIntegration: false, contextIsolation: true, sandbox: true };

function createWindow() {
  const window = new BrowserWindow({
    title: 'Rewind',
    width: 1080,
    height: 760,
    minWidth: 520,
    minHeight: 340,
    backgroundColor: '#fff8df',
    webPreferences: { ...sandboxed, preload: path.join(__dirname, 'preload.js') },
  });

  const pageSession = session.fromPartition('rewind-pages');
  pageSession.setPermissionCheckHandler(() => false);
  pageSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));

  const view = new WebContentsView({
    webPreferences: { ...sandboxed, session: pageSession },
  });
  view.setVisible(false);
  window.contentView.addChildView(view);

  function layout() {
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: height - TOOLBAR_HEIGHT });
  }
  layout();
  window.on('resize', layout);

  const toolbar = window.webContents;
  const browser = createBrowser(view, (state) => toolbar.send('browser:state', state));

  // Only the local main frame can send toolbar commands.
  const fromToolbar = (action) => (event, value) => {
    if (event.senderFrame === toolbar.mainFrame) action(value);
  };
  toolbar.ipc.on('browser:address', fromToolbar(browser.submit));
  toolbar.ipc.on('browser:back', fromToolbar(() => browser.travel(-1)));
  toolbar.ipc.on('browser:forward', fromToolbar(() => browser.travel(1)));
  toolbar.ipc.on('browser:ready', fromToolbar(() => toolbar.send('browser:state', browser.getState())));
  toolbar.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbar.on('will-navigate', (event) => event.preventDefault());

  window.once('closed', browser.close);
  void window.loadFile(path.join(__dirname, 'index.html'));
}

app.setName('Rewind');
app.whenReady().then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }])
    : null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
