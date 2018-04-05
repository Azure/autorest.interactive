"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron = require("electron");
const child_process_1 = require("child_process");
if (typeof electron === "string") {
    child_process_1.spawn(electron, [__filename], { stdio: ["ignore", "ignore", process.stderr, process.stdin, process.stdout] });
}
else {
    electron.app.on("ready", () => {
        require("./src/index");
    });
}
