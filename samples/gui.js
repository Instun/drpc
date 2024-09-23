const common = require('./res/common.js')

const gui = require("gui");
const path = require("path");

const win = gui.openFile(path.join(__dirname, "res", "index.html"), {
    debug: true
});

win.on("close", function () {
    process.exit(0);
});

common.handler(win);