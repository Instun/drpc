const common = require('./res/common.js')

const child_process = require("child_process");
const path = require("path");

async function main() {
    await common.test(child_process.fork(path.join(__dirname, "res", "handler-ipc.js")), {
        opened: true
    });
    process.exit(0);
}

main();
