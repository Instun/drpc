const { describe, it } = require('node:test');
const assert = require('node:assert');
const events = require('events');
const { open } = require('../lib');

// Helper function copied from handlers.test.js
function createConnection(handler, { opened = false } = {}) {
    const peer1 = new events.EventEmitter();
    const peer2 = new events.EventEmitter();
    let isOpen = opened;
    
    // Add context storage
    const contextStorage = new Map();
    peer1.context = peer2.context = contextStorage;
    
    // Add context methods
    peer1.setContext = peer2.setContext = (key, value) => {
        if (typeof key !== 'symbol') {
            throw new Error('Context key must be a Symbol');
        }
        contextStorage.set(key, value);
    };
    
    peer1.getContext = peer2.getContext = (key) => {
        if (typeof key !== 'symbol') {
            throw new Error('Context key must be a Symbol');
        }
        return contextStorage.get(key);
    };

    // Add send method
    peer1.send = data => {
        if (!isOpen) throw new Error('Connection closed');
        peer2.emit('message', { data });
    };
    peer2.send = data => {
        if (!isOpen) throw new Error('Connection closed');
        peer1.emit('message', { data });
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

    handler(peer1);
    return peer2;
}

describe('Handler Chain Context Tests', () => {
    it('should share data between handlers using this.params', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    process: [
                        async function first(input) {
                            this.params[0] = input.toUpperCase();
                        },
                        async function second(input) {
                            this.params[0] = `${input}!`;
                        },
                        async function last(input) {
                            return input;
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn);
        const result = await client.process('hello');
        assert.strictEqual(result, 'HELLO!');
    });

    it('should preserve handler context integrity', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    calculate: [
                        async function init(num) {
                            this.steps = [];
                            this.steps.push({ step: 'init', value: num });
                            this.params[0] = num * 2;
                        },
                        async function addFive(num) {
                            this.steps.push({ step: 'multiply', value: num });
                            this.params[0] = num + 5;
                        },
                        async function finish(num) {
                            this.steps.push({ step: 'add', value: num });
                            return {
                                result: num,
                                steps: this.steps
                            };
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn);
        const result = await client.calculate(10);
        
        assert.deepStrictEqual(result, {
            result: 25,
            steps: [
                { step: 'init', value: 10 },
                { step: 'multiply', value: 20 },
                { step: 'add', value: 25 }
            ]
        });
    });

    it('should share context between handlers in chain', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                timeout: 5000, // 增加超时时间
                routing: {
                    shareTest: [
                        async function first(input) {
                            // Use this context directly
                            this.shared = { input };
                            this.params[0] = input + '1';
                        },
                        async function second(modified) {
                            return {
                                original: this.shared.input,
                                modified
                            };
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn, { timeout: 5000 }); // 客户端也设置超时
        const result = await client.shareTest('test');
        assert.deepStrictEqual(result, {
            original: 'test',
            modified: 'test1'
        });
    });

    it('should handle Symbol context in middleware chain', async () => {
        const ctxKey = Symbol('middlewareContext');
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    chainTest: [
                        async function first(input) {
                            this.invoke[ctxKey] = input;
                            this.params[0] = 'modified';
                        },
                        async function second() {
                            return {
                                original: this.invoke[ctxKey],
                                modified: this.params[0]
                            };
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn);
        const result = await client.chainTest('original');
        assert.deepStrictEqual(result, {
            original: 'original',
            modified: 'modified'
        });
    });
});

describe('Connection Level Context Tests', () => {
    it('should share context at connection level using Symbols', async () => {
        const symbolKey = Symbol('contextKey');
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    getValue: async function() {
                        return this.invoke[symbolKey];
                    },
                    setValue: async function(value) {
                        this.invoke[symbolKey] = value;
                        return true;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn);
        await client.setValue('test-value');
        const result = await client.getValue();
        assert.strictEqual(result, 'test-value');
    });

    it('should handle invalid context usage', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    testInvalid: async function() {
                        try {
                            this.invoke['invalid-key'] = 'value';
                        } catch (err) {
                            return 'error-caught';
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn);
        const result = await client.testInvalid();
        assert.strictEqual(result, 'error-caught');
    });

    it('should isolate context between different connections', async () => {
        const symbolKey = Symbol('contextKey');
        const conn1 = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    getValue: async function() {
                        return this.invoke[symbolKey];
                    },
                    setValue: async function(value) {
                        this.invoke[symbolKey] = value;
                        return true;
                    }
                }
            });
        }, { opened: true });

        const conn2 = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    getValue: async function() {
                        return this.invoke[symbolKey];
                    },
                    setValue: async function(value) {
                        this.invoke[symbolKey] = value;
                        return true;
                    }
                }
            });
        }, { opened: true });

        const client1 = open(conn1);
        const client2 = open(conn2);

        await client1.setValue('value1');
        await client2.setValue('value2');

        const result1 = await client1.getValue();
        const result2 = await client2.getValue();

        assert.strictEqual(result1, 'value1');
        assert.strictEqual(result2, 'value2');
    });

    it('should support multiple Symbol contexts', async () => {
        const key1 = Symbol('context1');
        const key2 = Symbol('context2');
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    setMulti: async function(val1, val2) {
                        this.invoke[key1] = val1;
                        this.invoke[key2] = val2;
                        return true;
                    },
                    getMulti: async function() {
                        return {
                            value1: this.invoke[key1],
                            value2: this.invoke[key2]
                        };
                    }
                }
            });
        }, { opened: true });

        const client = open(conn);
        await client.setMulti('first', 'second');
        const result = await client.getMulti();
        assert.deepStrictEqual(result, {
            value1: 'first',
            value2: 'second'
        });
    });

    it('should preserve invoke context after reconnection', async () => {
        const reconnectKey = Symbol('reconnect');
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                timeout: 1000,
                routing: {
                    setValue: async function(value) {
                        this.invoke[reconnectKey] = value;
                        return true;
                    },
                    getValue: async function() {
                        return this.invoke[reconnectKey];
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { timeout: 1000 });
        
        await client.setValue('persist');
        conn.close(); // 触发断开
        await sleep(50); // 等待重连
        conn.open();  // 重新连接
        await sleep(50); // 等待连接就绪
        
        const result = await client.getValue();
        assert.strictEqual(result, 'persist');
    });
});

describe('Context Interaction Tests', () => {
    it('should support nested method calls sharing context', async () => {
        const contextKey = Symbol('sharedData');
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    outer: async function(value) {
                        // 在本地上下文中存储值
                        this.invoke[contextKey] = value;
                    },
                    inner: async function() {
                        // 从本地上下文中读取值
                        return this.invoke[contextKey];
                    }
                }
            });
        }, { opened: true });

        const client = open(conn);
        await client.outer('nested-test');
        const result = await client.inner();
        assert.strictEqual(result, 'nested-test');
    });

    it('should maintain request context isolation', async () => {
        const contextKey = Symbol('requestContext');
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    method1: async function() {
                        this[contextKey] = 'method1-data';
                        await sleep(10);
                        return this[contextKey];
                    },
                    method2: async function() {
                        this[contextKey] = 'method2-data';
                        await sleep(5);
                        return this[contextKey];
                    }
                }
            });
        }, { opened: true });

        const client = open(conn);
        const [result1, result2] = await Promise.all([
            client.method1(),
            client.method2()
        ]);
        
        assert.strictEqual(result1, 'method1-data');
        assert.strictEqual(result2, 'method2-data');
    });

    it('should maintain connection-level context with this.invoke', async () => {
        const contextKey1 = Symbol('methodContext1');
        const contextKey2 = Symbol('methodContext2');
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    method1: async function() {
                        // Store in connection context
                        this.invoke[contextKey1] = 'method1-data';
                        await sleep(10);
                        return this.invoke[contextKey1];
                    },
                    method2: async function() {
                        // Store in same connection but different key
                        this.invoke[contextKey2] = 'method2-data';
                        await sleep(5);
                        return this.invoke[contextKey2];
                    }
                }
            });
        }, { opened: true });

        const client = open(conn);
        const [result1, result2] = await Promise.all([
            client.method1(),
            client.method2()
        ]);
        
        assert.strictEqual(result1, 'method1-data');
        assert.strictEqual(result2, 'method2-data');
    });

    it('should handle cross-method context with invoke storage', async () => {
        const workflowIdKey = Symbol('workflowId');
        const stepsKey = Symbol('steps');
        const calls = [];

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    workflow: {
                        start: [
                            async function initContext() {
                                this.invoke[workflowIdKey] = Date.now();
                                this.invoke[stepsKey] = [];
                                return { started: true };
                            }
                        ],
                        step: [
                            async function checkContext() {
                                const workflowId = this.invoke[workflowIdKey];
                                if (!workflowId) {
                                    throw new Error('No workflow context found');
                                }
                                this.params[0] = {
                                    ...this.params[0],
                                    workflowId
                                };
                            },
                            async function recordStep(data) {
                                const steps = this.invoke[stepsKey];
                                steps.push(data.step);
                                calls.push(`step:${data.step}`);
                                return {
                                    workflowId: this.invoke[workflowIdKey],
                                    currentStep: data.step,
                                    totalSteps: steps.length
                                };
                            }
                        ],
                        complete: [
                            async function finalizeWorkflow() {
                                const workflowId = this.invoke[workflowIdKey];
                                if (!workflowId) {
                                    throw new Error('No workflow context found');
                                }

                                const result = {
                                    workflowId,
                                    steps: [...this.invoke[stepsKey]],
                                    completed: true
                                };

                                calls.push('complete');
                                return result;
                            }
                        ],
                        invalid: async function() {
                            return { hasContext: !!this.invoke[workflowIdKey] };
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 开始工作流
        const startResult = await client.workflow.start();
        assert.deepStrictEqual(startResult, { started: true });

        // 执行多个步骤
        const step1 = await client.workflow.step({ step: 'prepare' });
        assert.strictEqual(step1.currentStep, 'prepare');
        assert.strictEqual(step1.totalSteps, 1);

        const step2 = await client.workflow.step({ step: 'process' });
        assert.strictEqual(step2.currentStep, 'process');
        assert.strictEqual(step2.totalSteps, 2);

        // 完成工作流
        const completeResult = await client.workflow.complete();
        assert.deepStrictEqual(completeResult.steps, ['prepare', 'process']);
        assert.strictEqual(completeResult.completed, true);
    });
});

// Helper function for sleeping
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
