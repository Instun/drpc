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

    it('should handle fuzzy matching with longest prefix', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    // Generic user handler
                    "user": async function() {
                        // Store original method for testing
                        this.params[0] = {
                            originalMethod: this.method,
                            ...this.params[0],
                            processed: true
                        };
                        // Return modified params
                        return this.params[0];
                    },
                    
                    // More specific handler
                    "user.special": async function(data) {
                        return { special: true, data };
                    },

                    // Nested handlers
                    "api": {
                        "v1": async function() {
                            this.params[0] = {
                                version: 'v1',
                                ...this.params[0]
                            };
                            return this.params[0];
                        },
                        "v2": {
                            process: async function(data) {
                                return {
                                    version: 'v2',
                                    data
                                };
                            }
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // Test generic user handler
        const userResult = await client.user.profile.get({ name: 'test' });
        assert.deepStrictEqual(userResult, {
            originalMethod: 'profile.get',
            name: 'test',
            processed: true
        }, 'should handle generic user path with remaining method');

        // Test specific handler taking precedence
        const specialResult = await client.user.special({ type: 'test' });
        assert.deepStrictEqual(specialResult, {
            special: true,
            data: { type: 'test' }
        }, 'specific handler should take precedence');

        // Test nested API versioning
        const v1Result = await client.api.v1.users.list({ page: 1 });
        assert.deepStrictEqual(v1Result, {
            version: 'v1',
            page: 1
        }, 'should handle v1 API prefix');

        const v2Result = await client.api.v2.process({ data: 'test' });
        assert.deepStrictEqual(v2Result, {
            version: 'v2',
            data: { data: 'test' }
        }, 'should handle v2 API specific method');
    });

    it('should handle fuzzy matching in middleware chains', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    api: [
                        // Version middleware
                        async function() {
                            const version = this.method.split('.')[0];
                            if (version === 'v1' || version === 'v2') {
                                this.params[0] = {
                                    version,
                                    ...this.params[0]
                                };
                            }
                        },
                        // Auth middleware
                        async function() {
                            if (this.params[0]?.auth === false) {
                                throw new Error('Unauthorized');
                            }
                            this.params[0] = {
                                authenticated: true,
                                ...this.params[0]
                            };
                        },
                        // Route handlers
                        {
                            "v1.users": async function(data) {
                                return {
                                    path: 'v1.users',
                                    data
                                };
                            },
                            "v2.users": async function(data) {
                                return {
                                    path: 'v2.users',
                                    data
                                };
                            }
                        }
                    ]
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // Test v1 API with auth
        const v1Result = await client.api.v1.users({ auth: true });
        assert.deepStrictEqual(v1Result, {
            path: 'v1.users',
            data: {
                version: 'v1',
                auth: true,
                authenticated: true
            }
        }, 'should process v1 request through middleware chain');

        // Test v2 API with auth
        const v2Result = await client.api.v2.users({ auth: true });
        assert.deepStrictEqual(v2Result, {
            path: 'v2.users',
            data: {
                version: 'v2',
                auth: true,
                authenticated: true
            }
        }, 'should process v2 request through middleware chain');

        // Test unauthorized access
        await assert.rejects(
            async () => {
                await client.api.v1.users({ auth: false });
            },
            {
                message: 'Unauthorized'
            },
            'should reject unauthorized request'
        );
    });
});
