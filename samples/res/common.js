const rpc = require('../../lib')

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

var is_callback;

var test_func = function () { }

test_func.test6 = async function (v1, v2) {
    await sleep(200);
    return v1 + v2;
}

exports.handler = rpc.handler({
    test: async function (v1, v2) {
        await sleep(200);
        return v1 + v2;
    },
    "test.test1": async function (v1, v2) {
        await sleep(200);
        return v1 + v2;
    },
    "test.test1.test2": async function (v1, v2) {
        await sleep(200);
        return v1 + v2;
    },
    test1: {
        test2: async function (v1, v2) {
            await sleep(200);
            return v1 + v2;
        },
        test3: {
            test4: async function (v1, v2) {
                await sleep(200);
                return v1 + v2;
            }
        }
    },
    test_func: test_func,
    timeout: async function (v1, v2) {
        await sleep(20000);
        return v1 + v2;
    },
    close: async function () {
        if (is_callback)
            this[Symbol.for("conn")].close();
    },
    client_test: async function (v1, v2) {
        return await this.client_callback(v1, v2) + ", " + await this.test.test1(v1, v2);
    }
});

exports.test = async function (conn, opts) {
    is_callback = typeof conn === 'function';

    const remoting = rpc.open(conn, {
        ...opts,
        timeout: 3000,
        routing: {
            client_callback: async function (v1, v2) {
                await sleep(200);
                return "client_callback result: " + (v1 + v2);
            },
            test: {
                test1: async function (v1, v2) {
                    await sleep(200);
                    return "test.test1 result: " + (v1 + v2 + 20);
                }
            }
        }
    });

    console.log(`remoting.test(1, 2) === ${await remoting.test(1, 2)}`)
    console.log(`remoting.test.test1(2, 3) === ${await remoting.test.test1(2, 3)}`)
    console.log(`remoting.test.test1.test2(3, 4) === ${await remoting.test.test1.test2(3, 4)}`)
    console.log(`remoting.test1.test2(4, 5) === ${await remoting.test1.test2(4, 5)}`)
    console.log(`remoting.test1.test3.test4(5, 6) === ${await remoting.test1.test3.test4(5, 6)}`)
    console.log(`remoting.client_test(5, 6) === ${await remoting.client_test(5, 6)}`)

    try {
        await remoting.close();
    } catch (e) {
        console.log(e);
    }

    console.log(`remoting.test(1, 2) === ${await remoting.test(1, 2)}`)

    try {
        console.log(`remoting.timeout(5, 6) === ${await remoting.timeout(5, 6)}`)
    } catch (e) {
        console.log(e);
    }

    // console.log(`remoting.test2.test3(3, 4) === ${await remoting.test2.test3(4, 5)}`)
    // console.log(`remoting.test_func.test6(3, 4) === ${await remoting.test_func.test6(4, 5)}`)

    if (await remoting.test(1, 2) !== 3)
        console.log('test method is invalid.');
}
