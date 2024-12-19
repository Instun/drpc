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

describe('Performance and Load Tests', () => {
    it('should handle concurrent method calls correctly', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Simulate time-consuming operation
                    heavyOperation: async (num) => {
                        await sleep(Math.random() * 100); // Random delay
                        return num * 2;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Concurrently issue multiple requests
        const promises = Array.from({ length: 10 }, (_, i) =>
            client.heavyOperation(i)
        );

        const results = await Promise.all(promises);

        // Verify all results return correctly
        results.forEach((result, index) => {
            assert.strictEqual(result, index * 2);
        });
    });

    it('should handle large data correctly', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 5000,
                routing: {
                    processLargeArray: (arr) => {
                        return {
                            sum: arr.reduce((a, b) => a + b, 0),
                            length: arr.length,
                            first: arr[0],
                            last: arr[arr.length - 1]
                        };
                    },
                    processLargeString: (str) => {
                        return {
                            length: str.length,
                            firstChar: str[0],
                            lastChar: str[str.length - 1]
                        };
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 5000
        });

        // Test large array
        const largeArray = Array.from({ length: 10000 }, (_, i) => i);
        const arrayResult = await client.processLargeArray(largeArray);
        assert.strictEqual(arrayResult.length, 10000);
        assert.strictEqual(arrayResult.first, 0);
        assert.strictEqual(arrayResult.last, 9999);
        assert.strictEqual(arrayResult.sum, 49995000);

        // Test large string
        const largeString = 'a'.repeat(100000);
        const stringResult = await client.processLargeString(largeString);
        assert.strictEqual(stringResult.length, 100000);
        assert.strictEqual(stringResult.firstChar, 'a');
        assert.strictEqual(stringResult.lastChar, 'a');
    });

    it('should handle multiple slow concurrent calls', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Simulate a time-consuming operation
                    slowAdd: async (a, b) => {
                        await sleep(200);
                        return a + b;
                    }
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test multiple slow calls
        const slowResults = await Promise.all([
            client.slowAdd(1, 2),
            client.slowAdd(3, 4),
            client.slowAdd(5, 6)
        ]);
        assert.strictEqual(JSON.stringify(slowResults), JSON.stringify([3, 7, 11]), 'concurrent slow calls should work');
    });

    it('should handle mixed fast and slow concurrent calls', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Simulate a time-consuming operation
                    slowAdd: async (a, b) => {
                        await sleep(200);
                        return a + b;
                    },
                    // Simulate a fast operation
                    fastMultiply: (a, b) => a * b
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test mixed fast and slow calls
        const mixedResults = await Promise.all([
            client.slowAdd(1, 2),
            client.fastMultiply(3, 4),
            client.slowAdd(5, 6)
        ]);
        assert.strictEqual(JSON.stringify(mixedResults), JSON.stringify([3, 12, 11]), 'mixed concurrent calls should work');
    });

    it('should handle mixed success and error concurrent calls', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Simulate an operation that might fail
                    maybeError: async (shouldError) => {
                        await sleep(100);
                        if (shouldError) {
                            throw new Error('Intentional error');
                        }
                        return 'success';
                    }
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test successful and failed mixed calls
        const mixedSuccessAndError = await Promise.allSettled([
            client.maybeError(false),
            client.maybeError(true),
            client.maybeError(false)
        ]);

        assert.strictEqual(mixedSuccessAndError[0].status, 'fulfilled');
        assert.strictEqual(mixedSuccessAndError[0].value, 'success');

        assert.strictEqual(mixedSuccessAndError[1].status, 'rejected');
        assert.strictEqual(mixedSuccessAndError[1].reason.message, 'Intentional error');

        assert.strictEqual(mixedSuccessAndError[2].status, 'fulfilled');
        assert.strictEqual(mixedSuccessAndError[2].value, 'success');
    });

    it('should handle memory intensive operations', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // 处理大数组
                    processLargeArray: (arr) => {
                        const result = new Array(arr.length);
                        for (let i = 0; i < arr.length; i++) {
                            result[i] = arr[i] * 2;
                        }
                        return {
                            length: arr.length,
                            sum: arr.reduce((a, b) => a + b, 0),
                            doubled: result
                        };
                    },

                    // 处理大字符串
                    processLargeString: (str) => {
                        return {
                            length: str.length,
                            uppercase: str.toUpperCase(),
                            reversed: str.split('').reverse().join('')
                        };
                    },

                    // 处理深层嵌套对象
                    processDeepObject: function(obj, depth = 0) {
                        const self = this;
                        function processObject(obj, depth = 0) {
                            if (depth > 100) return null;
                            const result = {};
                            for (const key in obj) {
                                if (typeof obj[key] === 'object' && obj[key] !== null) {
                                    result[key] = processObject(obj[key], depth + 1);
                                } else {
                                    result[key] = obj[key];
                                }
                            }
                            return result;
                        }
                        return processObject(obj, depth);
                    },

                    // 生成大量小对象
                    generateManyObjects: (count) => {
                        return Array.from({ length: count }, (_, i) => ({
                            id: i,
                            value: Math.random(),
                            data: { nested: { level: i } }
                        }));
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试大数组处理
        const largeArray = Array.from({ length: 100000 }, (_, i) => i);
        const arrayResult = await client.processLargeArray(largeArray);
        assert.strictEqual(arrayResult.length, 100000);
        assert.strictEqual(arrayResult.doubled.length, 100000);

        // 测试大字符串处理
        const largeString = 'x'.repeat(1000000);
        const stringResult = await client.processLargeString(largeString);
        assert.strictEqual(stringResult.length, 1000000);
        assert.strictEqual(stringResult.uppercase.length, 1000000);
        assert.strictEqual(stringResult.reversed.length, 1000000);

        // 测试深层嵌套对象
        function createDeepObject(depth, breadth) {
            if (depth === 0) return { value: Math.random() };
            const obj = {};
            for (let i = 0; i < breadth; i++) {
                obj[`key${i}`] = createDeepObject(depth - 1, breadth);
            }
            return obj;
        }
        const deepObject = createDeepObject(5, 5);
        const deepResult = await client.processDeepObject(deepObject);
        assert.ok(deepResult !== null);

        // 测试大量小对象
        const manyObjects = await client.generateManyObjects(10000);
        assert.strictEqual(manyObjects.length, 10000);
        manyObjects.forEach((obj, i) => {
            assert.strictEqual(obj.id, i);
            assert.ok(typeof obj.value === 'number');
            assert.ok(obj.data.nested.level === i);
        });
    });

    it('should handle concurrent load with backpressure', async () => {
        // 创建一个限流器
        class RateLimiter {
            constructor(limit) {
                this.limit = limit;
                this.current = 0;
                this.queue = [];
            }

            async acquire() {
                if (this.current < this.limit) {
                    this.current++;
                    return true;
                }
                await new Promise(resolve => this.queue.push(resolve));
                this.current++;
                return true;
            }

            release() {
                this.current--;
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next();
                }
            }
        }

        const rateLimiter = new RateLimiter(5); // 最多5个并发

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // 模拟需要限流的操作
                    limitedOperation: async (id) => {
                        await rateLimiter.acquire();
                        try {
                            await sleep(Math.random() * 100);
                            return { id, processed: true };
                        } finally {
                            rateLimiter.release();
                        }
                    },

                    // 批量处理，但有内存限制
                    batchProcess: async (items) => {
                        const results = [];
                        // 每次只处理 1000 个项目
                        for (let i = 0; i < items.length; i += 1000) {
                            const batch = items.slice(i, i + 1000);
                            const batchResults = await Promise.all(
                                batch.map(async item => {
                                    await sleep(1);
                                    return { item, processed: true };
                                })
                            );
                            results.push(...batchResults);
                        }
                        return results;
                    },

                    // 长时间运行的操作
                    longRunning: async () => {
                        let result = 0;
                        for (let i = 0; i < 1000000; i++) {
                            if (i % 1000 === 0) {
                                await sleep(1); // 允许其他操作执行
                            }
                            result += i;
                        }
                        return result;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试限流操作
        const limitedResults = await Promise.all(
            Array.from({ length: 20 }, (_, i) => client.limitedOperation(i))
        );
        assert.strictEqual(limitedResults.length, 20);
        limitedResults.forEach((result, i) => {
            assert.deepStrictEqual(result, { id: i, processed: true });
        });

        // 测试批量处理
        const largeInput = Array.from({ length: 5000 }, (_, i) => i);
        const batchResults = await client.batchProcess(largeInput);
        assert.strictEqual(batchResults.length, 5000);

        // 测试长时间运行的操作与并发
        const [longResult, ...concurrentResults] = await Promise.all([
            client.longRunning(),
            client.limitedOperation(1),
            client.limitedOperation(2),
            client.limitedOperation(3)
        ]);
        assert.ok(longResult > 0);
        assert.strictEqual(concurrentResults.length, 3);
    });
});
