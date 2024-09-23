const common = require('./res/common.js')

const events = require('events');

function mq_connect(handler) {
    const peer1 = new events.EventEmitter();
    const peer2 = new events.EventEmitter();

    peer1.send = peer2.emit.bind(peer2, 'message');
    peer2.send = peer1.emit.bind(peer1, 'message');

    handler(peer1);
    return peer2;
}

async function main() {
    await common.test(mq_connect(common.handler), {
        opened: true
    });
    process.exit(0);
}

main();
