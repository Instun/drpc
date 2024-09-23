const common = require('./res/common.js')

const { Worker } = require('worker_threads');
const path = require("path");

async function main() {
    await common.test(new Worker(path.join(__dirname, "res", "handler-worker.js")), {
        opened: true
    });
    process.exit(0);
}

main();
