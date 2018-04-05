"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const plugin_host_1 = require("./jsonrpc/plugin-host");
const fs_1 = require("fs");
const js_yaml_1 = require("js-yaml");
// required to actually keep process running when window is closed
electron_1.app.on('window-all-closed', () => { });
const pluginHost = new plugin_host_1.AutoRestPluginHost();
pluginHost.Add("autorest-interactive", (initiator) => __awaiter(this, void 0, void 0, function* () {
    const win = new electron_1.BrowserWindow({});
    win.maximize();
    win.setMenu(null);
    if (yield initiator.GetValue("debug")) {
        win.webContents.openDevTools();
    }
    const readFileListener = (event, uri) => __awaiter(this, void 0, void 0, function* () {
        event.returnValue = yield initiator.ReadFile(uri);
    });
    const remoteEvalListener = (event, expression) => __awaiter(this, void 0, void 0, function* () {
        event.returnValue = js_yaml_1.safeLoad(yield initiator.GetValue("__status." + new Buffer(expression).toString("base64")));
    });
    electron_1.ipcMain.on("readFile", readFileListener);
    electron_1.ipcMain.on("remoteEval", remoteEvalListener);
    win.loadURL(`${__dirname}/autorest-interactive/index.html`);
    yield new Promise(res => win.once("closed", res));
    electron_1.ipcMain.removeListener("remoteEval", remoteEvalListener);
    electron_1.ipcMain.removeListener("readFile", readFileListener);
}));
const parent_stdin = fs_1.createReadStream(null, { fd: 3 });
const parent_stdout = fs_1.createWriteStream(null, { fd: 4 });
pluginHost.Run(parent_stdin, parent_stdout);
