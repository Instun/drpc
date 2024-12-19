const { describe, it } = require('node:test');
const assert = require('node:assert');
const events = require('events');
const { open } = require('../lib');

// Helper function for sleeping
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to create test connections
function createConnection(handler, { opened = false } = {}) {
    const peer1 = new events.EventEmitter();
    const peer2 = new events.EventEmitter();
    let isOpen = opened;

    // Add send method
    peer1.send = data => {
        if (!isOpen) throw new Error('Connection closed');
        peer2.emit('message', { data });
    };
    peer2.send = data => {
        if (!isOpen) throw new Error('Connection closed');
        peer1.emit('message', { data });
    };

    // Add event listeners
    peer1.addEventListener = (event, handler) => {
        if (event === 'open' && isOpen) {
            handler();
        }
        peer1.on(event, handler);
    };
    peer2.addEventListener = (event, handler) => {
        if (event === 'open' && isOpen) {
            handler();
        }
        peer2.on(event, handler);
    };

    // Add open/close methods
    peer1.open = peer2.open = () => {
        isOpen = true;
        peer1.emit('open');
        peer2.emit('open');
    };

    peer1.close = peer2.close = () => {
        isOpen = false;
        peer1.emit('close');
        peer2.emit('close');
    };

    handler(peer1);
    return peer2;
}

describe('Basic RPC Features', () => {
    it('should handle basic method call', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    test: async (a, b) => {
                        await sleep(200);
                        return a + b;
                    }
                }
            });
        }, { opened: true });  // Create an opened connection

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        const result = await client.test(1, 2);
        assert.strictEqual(result, 3, 'test(1, 2) should return 3');
    });

    it('should handle multiple concurrent calls', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    add: async (a, b) => {
                        await sleep(100);
                        return a + b;
                    },
                    multiply: async (a, b) => {
                        await sleep(100);
                        return a * b;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        const results = await Promise.all([
            client.add(2, 3),
            client.multiply(2, 3),
            client.add(4, 5),
            client.multiply(4, 5)
        ]);

        assert.deepStrictEqual(results, [5, 6, 9, 20], 'Concurrent calls should return correct results');
    });

    it('should handle different parameter types', async () => {
        const testObj = { name: 'test', value: 42 };
        const testArray = [1, 2, 3];
        
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                routing: {
                    echoString: str => str,
                    echoNumber: num => num,
                    echoBoolean: bool => bool,
                    echoObject: obj => obj,
                    echoArray: arr => arr,
                    echoNull: val => val,
                    returnUndefined: () => undefined,  // 显式返回 undefined
                    returnVoid: () => {},             // 隐式返回 undefined
                    returnNull: () => null            // 返回 null
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 基本类型测试
        assert.strictEqual(await client.echoString('hello'), 'hello', 'Should handle string');
        assert.strictEqual(await client.echoNumber(42.5), 42.5, 'Should handle number');
        assert.strictEqual(await client.echoBoolean(true), true, 'Should handle boolean');
        
        // 复杂类型测试
        assert.deepStrictEqual(await client.echoObject(testObj), testObj, 'Should handle object');
        assert.deepStrictEqual(await client.echoArray(testArray), testArray, 'Should handle array');
        
        // null 和 undefined 测试
        assert.strictEqual(await client.echoNull(null), null, 'Should handle null parameter');
        assert.strictEqual(await client.returnNull(), null, 'Should handle null return value');
        assert.strictEqual(await client.returnUndefined(), null, 'Should handle explicit undefined return as null');
        assert.strictEqual(await client.returnVoid(), null, 'Should handle implicit undefined return as null');
    });

    it('should handle empty parameters', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                routing: {
                    noParams: () => 'success',
                    optionalParam: (param = 'default') => param
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        assert.strictEqual(await client.noParams(), 'success', 'Should handle no parameters');
        assert.strictEqual(await client.optionalParam(), 'default', 'Should handle optional parameter with default value');
        assert.strictEqual(await client.optionalParam('custom'), 'custom', 'Should handle optional parameter with provided value');
    });

    it('should handle large payloads', async () => {
        const largeArray = Array.from({ length: 1000 }, (_, i) => ({ id: i, data: 'x'.repeat(100) }));
        
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                routing: {
                    processLargePayload: data => ({
                        count: data.length,
                        firstId: data[0].id,
                        lastId: data[data.length - 1].id
                    })
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        const result = await client.processLargePayload(largeArray);
        assert.deepStrictEqual(result, {
            count: 1000,
            firstId: 0,
            lastId: 999
        }, 'Should correctly process large payload');
    });

    it('should handle method chaining', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                routing: {
                    math: {
                        add: (a, b) => a + b,
                        multiply: (a, b) => a * b
                    },
                    string: {
                        concat: (a, b) => a + b,
                        reverse: str => str.split('').reverse().join('')
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        assert.strictEqual(await client.math.add(2, 3), 5, 'Should handle math.add');
        assert.strictEqual(await client.math.multiply(2, 3), 6, 'Should handle math.multiply');
        assert.strictEqual(await client.string.concat('hello', 'world'), 'helloworld', 'Should handle string.concat');
        assert.strictEqual(await client.string.reverse('hello'), 'olleh', 'Should handle string.reverse');
    });

    it('should handle primitive values as handlers', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                routing: {
                    // 使用原始值作为处理器
                    stringValue: 'hello',
                    numberValue: 42,
                    booleanValue: true,
                    nullValue: null,
                    undefinedValue: undefined,
                    // 嵌套对象中的原始值
                    nested: {
                        string: 'nested',
                        number: 100,
                        boolean: false
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试顶层原始值
        assert.strictEqual(await client.stringValue(), 'hello', 'should handle string value');
        assert.strictEqual(await client.numberValue(), 42, 'should handle number value');
        assert.strictEqual(await client.booleanValue(), true, 'should handle boolean value');
        assert.strictEqual(await client.nullValue(), null, 'should handle null value');
        assert.strictEqual(await client.undefinedValue(), null, 'should handle undefined value as null');

        // 测试嵌套对象中的原始值
        assert.strictEqual(await client.nested.string(), 'nested', 'should handle nested string value');
        assert.strictEqual(await client.nested.number(), 100, 'should handle nested number value');
        assert.strictEqual(await client.nested.boolean(), false, 'should handle nested boolean value');
    });
});
