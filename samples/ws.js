const ws = require('ws')
const http = require('http')

const rpc = require('..')

const svr = new http.Server(8811, ws.upgrade(
    rpc.handler(
        {
            test: function (v1, v2) {
                return v1 + v2;
            }
        }
    ))
);
svr.start();

async function main() {
    const remoting = rpc.open(new ws.Socket("ws://127.0.0.1:8811"));

    console.log(`remote.test(1, 2) === ${await remoting.test(1, 2)}`)
    console.assert(await remoting.test(1, 2) === 3, 'test method is invalid.')

    process.exit(0);
}

main();
