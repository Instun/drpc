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

describe('Context Handling Tests', () => {
    it('should provide RPC method context', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    contextTest: async function() {
                        return {
                            method: this.method,
                            hasParams: Array.isArray(this.params),
                            id: this.id  // 修改: messageId -> id 匹配实际上下文属性名
                        };
                    }
                }
            });
        }, { opened: true });

        const client = open(conn);
        const result = await client.contextTest();

        // 修改: 使用 id 而不是 messageId 进行断言
        assert.strictEqual(result.method, 'contextTest', 'method name should be available in context');
        assert.strictEqual(result.hasParams, true, 'params should be an array');
        assert.ok(typeof result.id === 'number' && result.id >= 0, 'should have valid message id');
    });

    it('should handle middleware context sharing and tracking', async () => {
        // 创建一个通用的上下文管理器
        const contextManager = {
            values: new Map(),
            operations: [],
            getValue(key) {
                this.operations.push(`get:${key}`);
                return this.values.get(key);
            },
            setValue(key, value) {
                this.operations.push(`set:${key}`);
                this.values.set(key, value);
            },
            clearOperations() {
                this.operations = [];
            }
        };

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    context: {
                        // 设置上下文值
                        set: [
                            async function validateInput(data) {
                                if (!data || typeof data.key !== 'string') {
                                    this.params[0] = { error: 'Invalid input' };
                                } else {
                                    this.params[0] = { ...data };
                                }
                            },
                            async function setAndTrack(data) {
                                if (data.error) {
                                    throw new Error(data.error);
                                }
                                contextManager.setValue(data.key, data.value);
                                return { success: true, key: data.key };
                            }
                        ],
                        // 获取上下文值
                        get: [
                            async function validateKey(key) {
                                const isValid = typeof key === 'string';  // 修改: 添加验证结果
                                this.params[0] = { 
                                    key,
                                    isValid,
                                    error: isValid ? null : 'Invalid key'
                                };
                            },
                            async function getValue(data) {
                                if (!data.isValid) {
                                    throw new Error(data.error);
                                }
                                const value = contextManager.getValue(data.key);
                                if (value === undefined) {
                                    throw new Error('Key not found');
                                }
                                return { 
                                    key: data.key, 
                                    value,
                                    isKeyValid: true  // 修改: 添加验证标记到返回值
                                };
                            }
                        ],
                        // 在中间件链中传递上下文
                        process: [
                            async function first(data) {
                                contextManager.setValue('_temp', data);
                                this.params[0] = { 
                                    step: 1,
                                    tempSet: true,
                                    originalData: data
                                };
                            },
                            async function second() {
                                const tempData = contextManager.getValue('_temp');
                                this.params[0] = {
                                    ...this.params[0],
                                    step: 2,
                                    tempData,
                                    tempRetrieved: true
                                };
                            },
                            async function final() {
                                const result = {
                                    ...this.params[0],
                                    operations: contextManager.operations,
                                    tempCleared: true
                                };
                                contextManager.setValue('_temp', null);
                                return result;
                            }
                        ]
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试基本的设置和获取
        const setResult = await client.context.set({ key: 'testKey', value: 'testValue' });
        assert.deepStrictEqual(setResult, { success: true, key: 'testKey' });

        const getResult = await client.context.get('testKey');
        assert.ok(getResult.isKeyValid, 'key should be valid');
        assert.strictEqual(getResult.key, 'testKey');
        assert.strictEqual(getResult.value, 'testValue');

        // 测试错误处理
        await assert.rejects(
            () => client.context.get('nonexistent'),
            { message: 'Key not found' }
        );

        await assert.rejects(
            () => client.context.set(null),
            { message: 'Invalid input' }
        );

        // 测试中间件链中的上下文传递
        contextManager.clearOperations();
        const processResult = await client.context.process({ test: true });
        
        // 验证处理流程的每个步骤
        assert.strictEqual(processResult.step, 2);
        assert.ok(processResult.tempSet, 'should set temp data');
        assert.ok(processResult.tempRetrieved, 'should retrieve temp data');
        assert.ok(processResult.tempCleared, 'should clear temp data');
        assert.deepStrictEqual(processResult.originalData, { test: true });
        assert.deepStrictEqual(processResult.operations, [
            'set:_temp',
            'get:_temp',
            'set:_temp'
        ]);

        // 验证临时数据已被清理
        const finalTempValue = contextManager.getValue('_temp');
        assert.strictEqual(finalTempValue, null);
    });

    it('should handle cross-method context with WeakMap', async () => {
        // 创建一个 WeakMap 来存储方法调用上下文
        const methodContexts = new WeakMap();
        
        // 用于跟踪调用顺序
        const calls = [];

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    workflow: {
                        start: [
                            async function initContext() {
                                // 使用 this.invoke 作为 key 存储上下文
                                methodContexts.set(this.invoke, {
                                    workflowId: Date.now(),
                                    steps: []
                                });
                                return { started: true };
                            }
                        ],
                        step: [
                            async function checkContext() {
                                // 获取当前工作流上下文
                                const context = methodContexts.get(this.invoke);
                                if (!context) {
                                    throw new Error('No workflow context found');
                                }
                                this.params[0] = {
                                    ...this.params[0],
                                    workflowId: context.workflowId
                                };
                            },
                            async function recordStep(data) {
                                const context = methodContexts.get(this.invoke);
                                context.steps.push(data.step);
                                calls.push(`step:${data.step}`);
                                return {
                                    workflowId: context.workflowId,
                                    currentStep: data.step,
                                    totalSteps: context.steps.length
                                };
                            }
                        ],
                        complete: [
                            async function finalizeWorkflow() {
                                const context = methodContexts.get(this.invoke);
                                if (!context) {
                                    throw new Error('No workflow context found');
                                }

                                const result = {
                                    workflowId: context.workflowId,
                                    steps: [...context.steps],
                                    completed: true
                                };

                                // 清理上下文
                                methodContexts.delete(this.invoke);
                                calls.push('complete');

                                return result;
                            }
                        ],
                        // 用于测试无上下文的情况
                        invalid: async function() {
                            const context = methodContexts.get(this.invoke);
                            return { hasContext: !!context };
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

        // 验证调用顺序
        assert.deepStrictEqual(calls, [
            'step:prepare',
            'step:process',
            'complete'
        ]);

        // 验证无上下文的调用
        const invalidResult = await client.workflow.invalid();
        assert.deepStrictEqual(invalidResult, { hasContext: false });

        // 验证上下文已被清理
        const finalResult = await client.workflow.step({ step: 'extra' }).catch(e => e);
        assert.ok(finalResult instanceof Error);
        assert.strictEqual(finalResult.message, 'No workflow context found');
    });
});
