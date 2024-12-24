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

describe('Error Handling Tests', () => {
    it('should handle synchronous errors', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                routing: {
                    // Synchronous error
                    throwError: () => {
                        throw new Error('Test error');
                    }
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test synchronous error
        await assert.rejects(async () => {
            await client.throwError();
        }, {
            message: 'Test error'
        });
    });

    it('should handle asynchronous errors', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                routing: {
                    // Asynchronous error
                    throwAsyncError: async () => {
                        await sleep(200);
                        throw new Error('Async test error');
                    }
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test asynchronous error
        await assert.rejects(async () => {
            await client.throwAsyncError();
        }, {
            message: 'Async test error'
        });
    });

    it('should handle input validation errors', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                routing: {
                    // Input validation error
                    validateInput: (num) => {
                        if (typeof num !== 'number') {
                            throw new Error('Input must be a number');
                        }
                        return num * 2;
                    }
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test input validation error
        await assert.rejects(async () => {
            await client.validateInput('not a number');
        }, {
            message: 'Input must be a number'
        });

        // Confirm normal input still works
        const result = await client.validateInput(5);
        assert.strictEqual(result, 10, 'should work with valid input');
    });

    it('should handle errors with enhanced information', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    throwBusinessError: () => {
                        const error = new Error('Invalid operation');
                        error.code = -32098; // Use custom error code
                        error.data = { field: 'operation', reason: 'invalid' };
                        throw error;
                    },
                    throwTypeError: () => {
                        throw new TypeError('Invalid type');
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test business error
        await assert.rejects(async () => {
            await client.throwBusinessError();
        }, {
            message: 'Invalid operation',
            code: -32098,
            data: { field: 'operation', reason: 'invalid' }
        });

        // Test type error
        await assert.rejects(async () => {
            await client.throwTypeError();
        }, {
            message: 'Invalid type',
            code: -32602,
            type: 'PROTOCOL'
        });
    });

    it('should handle circular references', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    handleCircularReference: () => {
                        function detectCircular(obj, seen = new Set()) {
                            if (obj === null || typeof obj !== 'object') return false;
                            if (seen.has(obj)) return true;
                            seen.add(obj);
                            return Object.values(obj).some(val => detectCircular(val, seen));
                        }

                        const obj = { a: 1 };
                        obj.self = obj;  // 创建循环引用

                        if (detectCircular(obj)) {
                            throw new Error('Circular reference detected');
                        }
                        return obj;
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        try {
            await client.handleCircularReference();
            assert.fail('Should throw error');
        } catch (err) {
            assert.ok(err.message.includes('Circular reference detected') || 
                     err.message.match(/circular|cyclic|Converting circular structure to JSON/i));
        }
    });

    it('should handle special characters and Unicode', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    handleSpecialChars: (input) => {
                        return {
                            input,
                            length: [...input].length,  // 使用展开运算符正确计算 Unicode 字符长度
                            codePoints: Array.from(input).map(c => c.codePointAt(0))
                        };
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        const specialCharsResult = await client.handleSpecialChars('Hello 你好 🌍');
        assert.strictEqual(specialCharsResult.length, [...'Hello 你好 🌍'].length);
        assert.ok(Array.isArray(specialCharsResult.codePoints));
        assert.ok(specialCharsResult.codePoints.length > 0);
    });

    it('should handle number precision and special values', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    handleNumbers: () => {
                        return {
                            max: Number.MAX_SAFE_INTEGER,
                            min: Number.MIN_SAFE_INTEGER,
                            infinity: Infinity,
                            nan: NaN,
                            precision: 0.1 + 0.2,  // 浮点数精度问题
                            bigint: String(9007199254740991n)  // 将 BigInt 转换为字符串
                        };
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        const numbersResult = await client.handleNumbers();
        assert.strictEqual(numbersResult.max, Number.MAX_SAFE_INTEGER);
        assert.strictEqual(numbersResult.min, Number.MIN_SAFE_INTEGER);
        assert.strictEqual(numbersResult.infinity, null);  // Infinity 会被转换为 null
        assert.strictEqual(numbersResult.nan, null);      // NaN 会被转换为 null
        assert.ok(Math.abs(numbersResult.precision - 0.3) < Number.EPSILON);
        assert.strictEqual(numbersResult.bigint, '9007199254740991');   // BigInt 转换为字符串
    });

    it('should handle custom error types', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    handleCustomError: (type) => {
                        class ValidationError extends Error {
                            constructor(message) {
                                super(message);
                                this.name = this.constructor.name;
                                this.code = -32099;
                                this.data = { type: 'validation' };
                            }
                        }

                        class ResourceError extends Error {
                            constructor(message) {
                                super(message);
                                this.name = this.constructor.name;
                                this.code = -32098;
                                this.data = { type: 'resource' };
                            }
                        }

                        switch (type) {
                            case 'validation':
                                throw new ValidationError('Invalid input');
                            case 'resource':
                                throw new ResourceError('Resource not found');
                            case 'type':
                                throw new TypeError('Invalid type');
                            case 'reference':
                                throw new ReferenceError('Invalid reference');
                            default:
                                throw new Error('Unknown error');
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试自定义错误
        await assert.rejects(
            () => client.handleCustomError('validation'),
            {
                message: 'Invalid input',
                code: -32099,
                data: { type: 'validation' }
            }
        );

        await assert.rejects(
            () => client.handleCustomError('resource'),
            {
                message: 'Resource not found',
                code: -32098,
                data: { type: 'resource' }
            }
        );

        // 测试标准 JavaScript 错误
        await assert.rejects(
            () => client.handleCustomError('type'),
            {
                message: 'Invalid type'
            }
        );

        await assert.rejects(
            () => client.handleCustomError('reference'),
            {
                message: 'Invalid reference'
            }
        );
    });

    it('should handle error stack and async error chains', async () => {
        const conn = createConnection(conn => {
            open(conn, {
                opened: true,
                routing: {
                    handleErrorStack: async () => {
                        const level3 = async () => {
                            const err = new Error('Deep error');
                            Error.captureStackTrace(err, level3);
                            throw err;
                        };
                        const level2 = async () => {
                            try {
                                await level3();
                            } catch (err) {
                                Error.captureStackTrace(err, level2);
                                throw err;
                            }
                        };
                        const level1 = async () => {
                            try {
                                await level2();
                            } catch (err) {
                                Error.captureStackTrace(err, level1);
                                throw err;
                            }
                        };
                        await level1();
                    },

                    handleAsyncErrorChain: async () => {
                        try {
                            await Promise.reject(new Error('First error'));
                        } catch (err) {
                            err.message = 'Second error: ' + err.message;
                            throw err;
                        }
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, { opened: true });

        // 测试错误堆栈
        try {
            await client.handleErrorStack();
            assert.fail('Should throw error');
        } catch (err) {
            assert.strictEqual(err.message, 'Deep error');
            assert.ok(err.stack, 'Error should have a stack trace');
        }

        // 测试异步错误链
        try {
            await client.handleAsyncErrorChain();
            assert.fail('Should throw error');
        } catch (err) {
            assert.strictEqual(err.message, 'Second error: First error');
        }
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
});
