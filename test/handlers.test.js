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

describe('Handler Chain Tests', () => {
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

    it('should preserve context in handler chain', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    contextTest: [
                        async function() {
                            // The RPC message context should include method name
                            assert.strictEqual(this.method, 'contextTest');
                            // Params should be an array
                            assert.ok(Array.isArray(this.params));
                            return 'success';
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn);
        const result = await client.contextTest();
        assert.strictEqual(result, 'success');
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

    it('should handle exact method match with nested structure', async () => {
        const conn = createConnection(conn => {
            // Server side with nested routing structure
            open(conn, {
                opened: true,
                routing: {
                    api: {
                        user: {
                            // Full method name as nested structure
                            getProfile: async (userId) => {
                                return { id: userId, name: 'Test User' };
                            }
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test exact method match with nested structure
        const profileResult = await client.api.user.getProfile(123);
        assert.deepStrictEqual(profileResult, { id: 123, name: 'Test User' }, 'exact method match should work');
    });

    it('should handle fallback to parent handler', async () => {
        const conn = createConnection(conn => {
            // Server side with nested routing structure
            open(conn, {
                opened: true,
                routing: {
                    api: {
                        user: {
                            // Method for handling unknown sub-paths
                            process: async (data) => {
                                return { processed: data };
                            }
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test fallback to parent handler
        const userResult = await client.api.user.process({ test: true });
        assert.deepStrictEqual(userResult, { processed: { test: true } }, 'should use parent handler');
    });

    it('should handle exact match vs nested path', async () => {
        const conn = createConnection(conn => {
            // Server side with nested routing structure
            open(conn, {
                opened: true,
                routing: {
                    service: {
                        // Direct method
                        handler: async (type) => {
                            return `Handled ${type}`;
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test exact match vs nested path
        const handlerResult = await client.service.handler('test');
        assert.strictEqual(handlerResult, 'Handled test', 'should use exact match');
    });

    it('should handle deeply nested methods', async () => {
        const conn = createConnection(conn => {
            // Server side with nested routing structure
            open(conn, {
                opened: true,
                routing: {
                    service: {
                        nested: {
                            handler: {
                                process: async () => 'processed'
                            }
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test nested handler
        const nestedResult = await client.service.nested.handler.process();
        assert.strictEqual(nestedResult, 'processed', 'should handle deeply nested methods');
    });

    it('should handle root level default handler', async () => {
        const conn = createConnection(conn => {
            // Server side with nested routing structure
            open(conn, {
                opened: true,
                routing: {
                    api: {
                        // Method for handling unknown paths under api
                        default: async () => {
                            return 'api root';
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test root level default handler
        const apiResult = await client.api.default();
        assert.strictEqual(apiResult, 'api root', 'should handle root level default handler');
    });

    it('should handle middleware error recovery', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // 测试中间件错误恢复
                    errorRecovery: [
                        async function maybeError(shouldError) {
                            if (shouldError) {
                                const err = new Error('Middleware error');
                                err.code = -32000;
                                err.data = { type: 'MIDDLEWARE' };
                                throw err;
                            }
                            this.params[0] = 'recovered';
                        },
                        async function errorHandler(err) {
                            if (err instanceof Error && err.data?.type === 'MIDDLEWARE') {
                                throw err;  // 重新抛出错误，让调用者处理
                            }
                            return this.params[0];  // 返回处理过的参数
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试错误恢复
        try {
            await client.errorRecovery(true);
            assert.fail('Should throw error');
        } catch (err) {
            assert.strictEqual(err.message, 'Middleware error');
            assert.strictEqual(err.code, -32000);
            assert.deepStrictEqual(err.data, { type: 'MIDDLEWARE' });
        }

        const errorResult2 = await client.errorRecovery(false);
        assert.strictEqual(errorResult2, 'recovered');
    });

    it('should handle middleware context sharing', async () => {
        // 创建一个共享上下文
        const sharedContext = {
            values: new Map(),
            getContext(key) {
                return this.values.get(key);
            },
            setContext(key, value) {
                this.values.set(key, value);
            }
        };

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // 测试中间件上下文共享
                    contextSharing: {
                        set: [
                            async function validateKey(key) {
                                if (typeof key !== 'string') {
                                    throw new Error('Invalid key');
                                }
                                this.params[0] = key;
                            },
                            async function setValue(key) {
                                const value = Date.now();
                                sharedContext.setContext(key, value);
                                this.params[0] = { key, value };
                            },
                            async function returnSetValue(data) {
                                return { key: data.key, set: true };
                            }
                        ],
                        get: [
                            async function validateKey(key) {
                                if (typeof key !== 'string') {
                                    throw new Error('Invalid key');
                                }
                                this.params[0] = key;
                            },
                            async function getValue(key) {
                                const value = sharedContext.getContext(key);
                                if (!value) {
                                    throw new Error('Key not found');
                                }
                                this.params[0] = { key, value };
                            },
                            async function returnGetValue(data) {
                                return data;
                            }
                        ]
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试上下文共享
        await client.contextSharing.set('testKey');
        const contextResult = await client.contextSharing.get('testKey');
        assert.ok(contextResult.value > 0);
        assert.strictEqual(contextResult.key, 'testKey');

        await assert.rejects(
            () => client.contextSharing.get('nonexistent'),
            { message: 'Key not found' }
        );
    });

    it('should handle conditional middleware', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // 测试条件中间件
                    conditionalChain: [
                        async function checkCondition(data) {
                            const shouldSkip = data.skip === true;
                            // 设置跳过标记
                            this.params[0] = { ...data, _skip: shouldSkip };
                        },
                        async function processData(data) {
                            if (data._skip) {
                                this.params[0] = { skipped: true };
                            } else {
                                this.params[0] = { processed: true, data };
                            }
                        },
                        async function finalStep(data) {
                            return data;
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试条件中间件
        const skipResult = await client.conditionalChain({ skip: true, data: 'test' });
        assert.deepStrictEqual(skipResult, { skipped: true });

        const processResult = await client.conditionalChain({ skip: false, data: 'test' });
        assert.deepStrictEqual(processResult, { 
            processed: true, 
            data: { skip: false, data: 'test', _skip: false } 
        });
    });

    it('should handle dynamic middleware chains', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // 测试动态中间件
                    dynamicChain: {
                        base: [
                            async function baseMiddleware(data) {
                                this.params[0] = { ...data, base: true };
                            },
                            async function finalMiddleware(data) {
                                return data;  // 返回最终结果
                            }
                        ],
                        extended: [
                            async function baseMiddleware(data) {
                                this.params[0] = { ...data, base: true };
                            },
                            async function extensionMiddleware(data) {
                                this.params[0] = { ...data, extended: true };
                            },
                            async function finalMiddleware(data) {
                                return { ...data, final: true };
                            }
                        ]
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试动态中间件
        const baseResult = await client.dynamicChain.base({ test: true });
        assert.deepStrictEqual(baseResult, { test: true, base: true });

        const extendedResult = await client.dynamicChain.extended({ test: true });
        assert.deepStrictEqual(extendedResult, { 
            test: true, 
            base: true, 
            extended: true,
            final: true 
        });
    });

    it('should handle middleware context tracking', async () => {
        // 创建一个上下文追踪器
        const contextTracker = {
            contexts: [],
            add(context) {
                this.contexts.push(context);
            },
            clear() {
                this.contexts = [];
            }
        };

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // 测试中间件上下文追踪
                    contextTracking: [
                        async function firstHandler() {
                            contextTracker.add('first');
                        },
                        async function secondHandler() {
                            contextTracker.add('second');
                            return 'tracked';
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 清除追踪器
        contextTracker.clear();

        // 测试中间件上下文追踪
        const result = await client.contextTracking();
        assert.strictEqual(result, 'tracked');
        assert.deepStrictEqual(contextTracker.contexts, ['first', 'second']);
    });

    it('should handle nested routing with middleware', async () => {
        const contextTracker = {
            contexts: [],
            add(context) {
                this.contexts.push(context);
            },
            clear() {
                this.contexts = [];
            }
        };

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    api: {
                        v1: {
                            users: {
                                // 用户相关操作
                                profile: {
                                    update: [
                                        async function validateProfile(data) {
                                            contextTracker.add('validate-profile');
                                            if (!data.name) throw new Error('Invalid profile');
                                            this.params[0] = data;
                                        },
                                        async function updateProfile(data) {
                                            contextTracker.add('update-profile');
                                            return { success: true, data: { name: data.name } };
                                        }
                                    ],
                                    // 管理员更新用户信息的中间件链
                                    adminUpdate: [
                                        async function checkAdmin() {
                                            contextTracker.add('check-admin');
                                            throw new Error('Not implemented');
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 清除追踪器
        contextTracker.clear();

        // 测试嵌套路由中间件
        const updateResult = await client.api.v1.users.profile.update({ name: 'test' });
        assert.deepStrictEqual(updateResult, { success: true, data: { name: 'test' } });
        assert.deepStrictEqual(contextTracker.contexts, ['validate-profile', 'update-profile']);

        // 清除追踪器
        contextTracker.clear();

        // 测试管理员更新路由
        await assert.rejects(
            () => client.api.v1.users.profile.adminUpdate(),
            { message: 'Not implemented' }
        );
        assert.deepStrictEqual(contextTracker.contexts, ['check-admin']);
    });

    it('should handle settings validation middleware', async () => {
        const contextTracker = {
            contexts: [],
            add(context) {
                this.contexts.push(context);
            },
            clear() {
                this.contexts = [];
            }
        };

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    settings: {
                        update: [
                            async function validateSetting(data) {
                                contextTracker.add('validate-setting');
                                if (!data.key || !data.value) throw new Error('Invalid setting');
                                this.params[0] = data;
                            },
                            async function updateSetting(data) {
                                contextTracker.add('update-setting');
                                return { success: true, data };
                            }
                        ]
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 清除追踪器
        contextTracker.clear();

        // 测试设置验证中间件
        const settingResult = await client.settings.update({ key: 'theme', value: 'dark' });
        assert.deepStrictEqual(settingResult, { 
            success: true, 
            data: { key: 'theme', value: 'dark' } 
        });
        assert.deepStrictEqual(contextTracker.contexts, ['validate-setting', 'update-setting']);

        // 清除追踪器
        contextTracker.clear();

        // 测试无效设置
        await assert.rejects(
            () => client.settings.update({ key: 'theme' }),
            { message: 'Invalid setting' }
        );
        assert.deepStrictEqual(contextTracker.contexts, ['validate-setting']);
    });

    it('should handle context sharing between middlewares', async () => {
        const sharedContext = {
            values: new Map(),
            getContext(key) {
                return this.values.get(key);
            },
            setContext(key, value) {
                this.values.set(key, value);
            }
        };

        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    contextSharing: {
                        get: [
                            async function getContextValue(key) {
                                const value = sharedContext.getContext(key);
                                this.params[0] = { key, value };
                            },
                            async function returnValue(data) {
                                return data;
                            }
                        ]
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 设置共享上下文
        const testValue = 'test-value';
        sharedContext.setContext('testKey', testValue);

        // 测试中间件间的上下文共享
        const result = await client.contextSharing.get('testKey');
        assert.deepStrictEqual(result, { key: 'testKey', value: testValue });
    });
});
