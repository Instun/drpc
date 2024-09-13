const common = require('./common.js')

const ws = require('ws')
const http = require('http')

const svr = new http.Server(8811, ws.upgrade(common.handler));
svr.start();

async function main() {
    await common.test(new ws.Socket("ws://127.0.0.1:8811"));
    process.exit(0);
}

main();
