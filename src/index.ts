import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { AutoRestPluginHost } from './jsonrpc/plugin-host';
import { createReadStream, createWriteStream } from 'fs';
import { safeLoad } from 'js-yaml';

// required to actually keep process running when window is closed
app.on('window-all-closed', () => {});

const pluginHost = new AutoRestPluginHost();
pluginHost.Add('autorest-interactive', async (initiator) => {
    const win = new BrowserWindow({});
    win.maximize();
    win.setMenu(null);
    if (await initiator.GetValue('debug')) {
        win.webContents.openDevTools();
    }
    const readFileListener = async (event, uri) => {
        event.returnValue = await initiator.ReadFile(uri);
    };
    const remoteEvalListener = async (event, expression) => {
        event.returnValue = safeLoad(
            await initiator.GetValue(
                '__status.' + new Buffer(expression).toString('base64')
            )
        );
    };
    ipcMain.on('readFile', readFileListener);
    ipcMain.on('remoteEval', remoteEvalListener);
    win.loadURL(`${__dirname}/autorest-interactive/index.html`);
    await new Promise<void>((res) => win.once('closed', res));
    ipcMain.removeListener('remoteEval', remoteEvalListener);
    ipcMain.removeListener('readFile', readFileListener);
});
const parent_stdin = createReadStream(null, { fd: 3 });
const parent_stdout = createWriteStream(null, { fd: 4 });
pluginHost.Run(parent_stdin, parent_stdout);
