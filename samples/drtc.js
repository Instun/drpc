const common = require('./common.js')

const drtc = require('@instun/drtc');
const cert = require('./cert.json');

drtc.listen({
    port: 60916,
    key: cert.key, cert: cert.cert
}, common.handler);

async function main() {
    await common.test(drtc.connect(`drtc://127.0.0.1:60916/${cert.fingerprint}`));

    process.exit(0);
}

main();
