const { describe, it } = require('node:test');
const assert = require('node:assert');
const events = require('events');
const { open } = require('../../lib');

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

describe('Basic Handler Chain Tests', () => {
    it('should support handler chaining', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    transform: [
                        async function(text) {
                            // 通过修改 this.params 传递数据
                            this.params[0] = text.toUpperCase();
                        },
                        async function(text) {
                            // 继续修改参数
                            this.params[0] = text + '!';
                        },
                        async function(text) {
                            // 最后一个处理器返回最终结果
                            return `[${text}]`;
                        }
                    ],
                    // 测试参数传递
                    processNumbers: [
                        async function(num) {
                            // 第一个处理器：将数字翻倍
                            this.params[0] = num * 2;
                        },
                        async function(num) {
                            // 第二个处理器：加5
                            this.params[0] = num + 5;
                        },
                        async function(num) {
                            // 最后返回结果
                            return `Result: ${num}`;
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn);
        
        // 测试字符串转换链
        const result1 = await client.transform('hello');
        assert.strictEqual(result1, '[HELLO!]');

        // 测试数字处理链
        const result2 = await client.processNumbers(10);
        assert.strictEqual(result2, 'Result: 25'); // (10 * 2) + 5 = 25
    });

    it('should enforce handler chain return value rules', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    invalidChain: [
                        async function(text) {
                            return text.toUpperCase(); // This should throw error
                        },
                        async function(text) {
                            return text;
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn);
        
        // Test intermediate handler returning value
        try {
            await client.invalidChain('test');
            assert.fail('Should throw error');
        } catch (err) {
            assert.strictEqual(err.code, -32603);
            assert.strictEqual(err.message, 'Only the last handler in the chain can return a value');
        }
    });
});
