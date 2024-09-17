const child_process = require("child_process");
const path = require("path");

const common = require('./common.js')

const conn = child_process.fork(path.join(__dirname, "child.js"));
async function main() {
    await common.test(conn);
    process.exit(0);
}

main();
