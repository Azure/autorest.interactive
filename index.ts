import * as electron from "electron";
import { spawn } from "child_process";

if (typeof electron === "string") {
  // make sure that electron can be electron!
  delete process.env['ELECTRON_RUN_AS_NODE'];
  
  const proc = spawn(electron as any, [__filename], { stdio: ["ignore", "ignore", process.stderr, process.stdin, process.stdout] });
  (<any>process).on('exit', (code) => {
    proc.kill();
  });
} else {
  electron.app.on("ready", () => {
    require("./src/index");
  });
}
