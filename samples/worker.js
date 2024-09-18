const { Worker } = require('worker_threads');
const path = require("path");

const common = require('./common.js')

async function main() {
    await common.test(new Worker(path.join(__dirname, "handler-worker.js")), {
        opened: true
    });
    process.exit(0);
}

main();
