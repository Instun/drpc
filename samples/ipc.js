const child_process = require("child_process");
const path = require("path");

const common = require('./common.js')

async function main() {
    await common.test(child_process.fork(path.join(__dirname, "handler-ipc.js")), {
        opened: true
    });
    process.exit(0);
}

main();
