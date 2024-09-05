const drtc = require('@instun/drtc');
const cert = require('./cert.json');

const rpc = require('..')

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

drtc.listen({
    port: 60916,
    key: cert.key, cert: cert.cert
}, rpc.handler(
    {
        test: async function (v1, v2) {
            await sleep(200);
            return v1 + v2;
        }
    }
));

async function main() {
    const remoting = rpc.open(drtc.connect(`drtc://127.0.0.1:60916/${cert.fingerprint}`));

    console.log(`remote.test(1, 2) === ${await remoting.test(1, 2)}`)
    console.assert(await remoting.test(1, 2) === 3, 'test method is invalid.')

    process.exit(0);
}

main();
