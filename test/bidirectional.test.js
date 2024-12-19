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

describe('Bidirectional Communication Tests', () => {
    it('should handle basic bidirectional calls', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    processWithCallback: async function (data) {
                        const result = await this.invoke.transformData(data);
                        return `Processed: ${result}`;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                transformData: async function (data) {
                    return data.toUpperCase();
                }
            }
        });

        // Test basic bidirectional call
        const result = await client.processWithCallback('hello');
        assert.strictEqual(result, 'Processed: HELLO');
    });

    it('should handle callback chains', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    combineCallbacks: async function (num) {
                        const doubled = await this.invoke.doubleNumber(num);
                        const squared = await this.invoke.squareNumber(doubled);
                        const result = await this.invoke.processResult(squared);
                        return result;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                doubleNumber: async function (num) {
                    return num * 2;
                },
                squareNumber: async function (num) {
                    return num * num;
                },
                processResult: async function (data) {
                    return `Result: ${data}`;
                }
            }
        });

        // Test callback chain
        const result = await client.combineCallbacks(5);
        assert.strictEqual(result, 'Result: 100');  // (5 * 2)^2 = 100
    });

    it('should handle error propagation', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    handleClientError: async function () {
                        try {
                            await this.invoke.throwError();
                        } catch (err) {
                            assert.strictEqual(err.message, 'Test error');
                            return 'Error handled';
                        }
                        assert.fail('Should throw error');
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                throwError: async function () {
                    throw new Error('Test error');
                }
            }
        });

        // Test error handling
        const result = await client.handleClientError();
        assert.strictEqual(result, 'Error handled');
    });

    it('should handle recursive calls', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    startFactorial: async function (n) {
                        if (n <= 1) return 1;
                        const subResult = await this.invoke.calculateFactorial(n - 1);
                        return n * subResult;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                calculateFactorial: async function (n) {
                    if (n <= 1) return 1;
                    const subResult = await this.invoke.startFactorial(n - 1);
                    return n * subResult;
                }
            }
        });

        // Test recursive calculation
        const result = await client.startFactorial(5);
        assert.strictEqual(result, 120);  // 5! = 120
    });

    it('should handle nested processing', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    processNested: async function (data) {
                        const processed = await this.invoke.processData(data);
                        const finalized = await this.invoke.finalizeData(processed);
                        return finalized;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                processData: async function (data) {
                    if (typeof data === 'string') {
                        return data.toUpperCase();
                    }
                    if (Array.isArray(data)) {
                        const results = [];
                        for (const item of data) {
                            if (typeof item === 'string') {
                                results.push(await this.invoke.processNested(item));
                            } else {
                                results.push(item);
                            }
                        }
                        return results;
                    }
                    return data;
                },
                finalizeData: async function (data) {
                    if (Array.isArray(data)) {
                        return data.join('-');
                    }
                    return String(data);
                }
            }
        });

        // Test nested processing
        const result = await client.processNested(['hello', 'world']);
        assert.strictEqual(result, 'HELLO-WORLD');
    });

    it('should handle deep nested calls', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    startNestedCalls: async function (depth) {
                        if (depth <= 0) return 'done';
                        return this.invoke.nestedCall(depth);
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                nestedCall: async function (depth) {
                    if (depth <= 0) return 'done';
                    return this.invoke.startNestedCalls(depth - 1);
                }
            }
        });

        // Test deep nested calls
        const nestedResult = await client.startNestedCalls(3);
        assert.strictEqual(nestedResult, 'done');
    });

    it('should handle call chain interruption and recovery', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    startChain: async function (steps) {
                        let result = { steps: [] };
                        for (const step of steps) {
                            try {
                                result = await this.invoke.processStep({ ...result, current: step });
                            } catch (err) {
                                if (err.message === 'Chain interrupted') {
                                    // 处理中断
                                    result = await this.invoke.handleInterrupt(result);
                                    // 继续链
                                    result = await this.invoke.continueChain(result);
                                } else {
                                    throw err;
                                }
                            }
                        }
                        return result;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                processStep: async function (data) {
                    if (data.current === 'interrupt') {
                        throw new Error('Chain interrupted');
                    }
                    return {
                        steps: [...data.steps, data.current],
                        current: null
                    };
                },
                handleInterrupt: async function (data) {
                    return {
                        steps: [...data.steps, 'interrupted'],
                        current: null
                    };
                },
                continueChain: async function (data) {
                    return {
                        steps: [...data.steps, 'recovered'],
                        current: null
                    };
                }
            }
        });

        // Test chain interruption and recovery
        const chainResult = await client.startChain(['step1', 'interrupt', 'step2']);
        assert.deepStrictEqual(chainResult.steps, ['step1', 'interrupted', 'recovered', 'step2']);
    });

    it('should handle concurrent bidirectional calls', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    handleConcurrentCalls: async function (tasks) {
                        const results = await Promise.all([
                            this.invoke.task1(tasks[0]),
                            this.invoke.task2(tasks[1]),
                            this.invoke.task3(tasks[2])
                        ]);
                        return results.join(':');
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            routing: {
                task1: async function (data) {
                    await sleep(10);
                    return `task1:${data}`;
                },
                task2: async function (data) {
                    return `task2:${data}`;
                },
                task3: async function (data) {
                    await sleep(5);
                    return `task3:${data}`;
                }
            }
        });

        // Test concurrent calls
        const concurrentResult = await client.handleConcurrentCalls(['a', 'b', 'c']);
        assert.strictEqual(concurrentResult, 'task1:a:task2:b:task3:c');
    });
});
