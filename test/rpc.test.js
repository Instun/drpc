const { describe, it } = require('node:test');
const assert = require('node:assert');
const events = require('events');
const open = require("../lib/open");

// Delay function
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const symbol_state = Symbol.for("drpc.state");

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

describe('RPC Tests', () => {
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

    it('should handle server errors', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                routing: {
                    // Synchronous error
                    throwError: () => {
                        throw new Error('Test error');
                    },
                    // Asynchronous error
                    throwAsyncError: async () => {
                        await sleep(200);
                        throw new Error('Async test error');
                    },
                    // Input validation error
                    validateInput: (num) => {
                        if (typeof num !== 'number') {
                            throw new Error('Input must be a number');
                        }
                        return num * 2;
                    }
                }
            });
        }, { opened: true });  // Create an opened connection

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

        // Test asynchronous error
        await assert.rejects(async () => {
            await client.throwAsyncError();
        }, {
            message: 'Async test error'
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

    it('should handle concurrent calls', async () => {
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
                    fastMultiply: (a, b) => a * b,
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
        }, { opened: true });  // Create an opened connection

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

        // Test mixed fast and slow calls
        const mixedResults = await Promise.all([
            client.slowAdd(1, 2),
            client.fastMultiply(3, 4),
            client.slowAdd(5, 6)
        ]);
        assert.strictEqual(JSON.stringify(mixedResults), JSON.stringify([3, 12, 11]), 'mixed concurrent calls should work');

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

    it('should handle connection state changes and retries', async () => {
        const stateChanges = [];
        const conn = createConnection(() => {}, { opened: true });
        
        const client = open(conn, {
            maxRetries: 2,
            retryDelay: 100,
            onStateChange: (oldState, newState) => {
                stateChanges.push({ from: oldState, to: newState });
            }
        });

        // Initial state should be CONNECTED
        assert.strictEqual(client[symbol_state](), 'CONNECTED');
        
        // Test connection close and retry
        conn.close();
        await sleep(300); // Wait for all retries to complete
        
        // After max retries, should be in CLOSED state
        assert.strictEqual(client[symbol_state](), 'CLOSED');
        
        // Verify state transitions
        const transitions = stateChanges.map(c => c.to);
        assert(transitions.includes('CONNECTING'), 'Should include CONNECTING state');
        assert(transitions.includes('CONNECTED'), 'Should include CONNECTED state');
        assert(transitions.includes('RECONNECTING'), 'Should include RECONNECTING state');
        assert(transitions.includes('CLOSED'), 'Should include CLOSED state');
        
        // Verify the sequence: should start with CONNECTING and end with CLOSED
        assert.strictEqual(transitions[0], 'CONNECTING', 'Should start with CONNECTING');
        assert.strictEqual(transitions[transitions.length - 1], 'CLOSED', 'Should end with CLOSED');
    });

    it('should handle complex objects', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Return passed object
                    echo: obj => obj,
                    // Return complex object
                    getComplex: () => ({
                        string: 'hello',
                        number: 42,
                        boolean: true,
                        null: null,
                        undefined: undefined,
                        date: new Date('2023-01-01'),
                        nested: {
                            array: [1, 2, { x: 3 }],
                            object: { a: 1, b: { c: 2 } }
                        }
                    }),
                    // Process array operations
                    processArray: arr => ({
                        length: arr.length,
                        sum: arr.reduce((a, b) => a + b, 0),
                        doubled: arr.map(x => x * 2)
                    }),
                    // Merge objects
                    mergeObjects: (obj1, obj2) => ({
                        ...obj1,
                        ...obj2,
                        merged: true
                    })
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test echo complex object
        const testObj = {
            string: 'test',
            number: 123,
            array: [1, 2, 3],
            nested: { x: 1, y: { z: 2 } }
        };
        const echoed = await client.echo(testObj);
        assert.deepEqual(echoed, testObj, 'should echo complex object correctly');

        // Test get complex object
        const complex = await client.getComplex();
        assert.strictEqual(complex.string, 'hello', 'should handle string');
        assert.strictEqual(complex.number, 42, 'should handle number');
        assert.strictEqual(complex.boolean, true, 'should handle boolean');
        assert.strictEqual(complex.null, null, 'should handle null');
        assert.strictEqual(complex.undefined, undefined, 'should handle undefined');
        // Date will be serialized as ISO string
        assert.strictEqual(complex.date, '2023-01-01T00:00:00.000Z', 'should handle date as ISO string');
        assert.deepEqual(complex.nested.array, [1, 2, { x: 3 }], 'should handle nested array');
        assert.deepEqual(complex.nested.object, { a: 1, b: { c: 2 } }, 'should handle nested object');

        // Test array operations
        const arrayResult = await client.processArray([1, 2, 3, 4, 5]);
        assert.strictEqual(arrayResult.length, 5, 'should handle array length');
        assert.strictEqual(arrayResult.sum, 15, 'should handle array reduction');
        assert.deepEqual(arrayResult.doubled, [2, 4, 6, 8, 10], 'should handle array mapping');

        // Test object merging
        const merged = await client.mergeObjects(
            { a: 1, b: 2 },
            { b: 3, c: 4 }
        );
        assert.deepEqual(
            merged,
            { a: 1, b: 3, c: 4, merged: true },
            'should handle object merging'
        );
    });

    it('should handle bidirectional calls', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Process client method and handle result
                    processWithCallback: async function(data) {
                        // Call client's transformation method
                        const transformed = await this.transformData(data);
                        // Process transformed data on server
                        return {
                            original: data,
                            transformed,
                            length: transformed.length
                        };
                    },
                    // Combine multiple client callbacks
                    combineCallbacks: async function(num) {
                        // Call multiple client methods in parallel
                        const [doubled, squared] = await Promise.all([
                            this.doubleNumber(num),
                            this.squareNumber(num)
                        ]);
                        return {
                            original: num,
                            doubled,
                            squared
                        };
                    },
                    // Test callback chain
                    chainedCall: async function(data) {
                        // First step: call client's transformation
                        const step1 = await this.transformData(data);
                        // Second step: send transformed result to client for processing
                        const step2 = await this.processResult(step1);
                        // Return complete processing chain
                        return {
                            input: data,
                            step1,
                            step2,
                            completed: true
                        };
                    }
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000,
            routing: {
                // String transformation method
                transformData: async (data) => {
                    await sleep(100); // Simulate processing time
                    return data.toUpperCase();
                },
                // Number processing method
                doubleNumber: async (num) => {
                    await sleep(100);
                    return num * 2;
                },
                squareNumber: async (num) => {
                    await sleep(100);
                    return num * num;
                },
                // Result processing method
                processResult: async (data) => {
                    await sleep(100);
                    return `Processed: ${data}`;
                }
            }
        });

        // Test basic reverse call
        const result1 = await client.processWithCallback('hello');
        assert.deepEqual(result1, {
            original: 'hello',
            transformed: 'HELLO',
            length: 5
        }, 'should handle basic callback');

        // Test multiple parallel callbacks
        const result2 = await client.combineCallbacks(5);
        assert.deepEqual(result2, {
            original: 5,
            doubled: 10,
            squared: 25
        }, 'should handle parallel callbacks');

        // Test callback chain
        const result3 = await client.chainedCall('test');
        assert.deepEqual(result3, {
            input: 'test',
            step1: 'TEST',
            step2: 'Processed: TEST',
            completed: true
        }, 'should handle callback chain');
    });

    it('should handle bidirectional call errors and recursion', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Test client method throwing error
                    handleClientError: async function() {
                        try {
                            await this.throwError();
                            assert.fail('should throw error');
                        } catch (err) {
                            return {
                                caught: true,
                                message: err.message
                            };
                        }
                    },

                    // Test recursive calculation
                    startFactorial: async function(n) {
                        // Call client's recursive method
                        const result = await this.calculateFactorial(n);
                        return {
                            input: n,
                            result: result
                        };
                    },

                    // Test nested calls
                    processNested: async function(data) {
                        // First, let client process
                        const clientResult = await this.processData(data);
                        // If client requires further processing
                        if (clientResult.needsMoreProcessing) {
                            // Call client's final processing method
                            return await this.finalizeData(clientResult.data);
                        }
                        return clientResult;
                    }
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000,
            routing: {
                // Error throwing method
                throwError: async () => {
                    await sleep(100);
                    throw new Error('Client error');
                },

                // Recursive factorial calculation
                calculateFactorial: async (n) => {
                    await sleep(100);
                    if (n <= 1) return 1;
                    // Use server's startFactorial method for recursion
                    const { result } = await client.startFactorial(n - 1);
                    return n * result;
                },

                // Data processing method (for nested calls)
                processData: async (data) => {
                    await sleep(100);
                    // For string data, more processing is needed
                    if (typeof data === 'string') {
                        return {
                            needsMoreProcessing: true,
                            data: data.toUpperCase()
                        };
                    }
                    // For number data, return directly
                    return {
                        needsMoreProcessing: false,
                        data: data * 2
                    };
                },

                // Final processing method
                finalizeData: async (data) => {
                    await sleep(100);
                    return {
                        needsMoreProcessing: false,
                        data: `Finalized: ${data}`
                    };
                }
            }
        });

        // Test error handling
        const errorResult = await client.handleClientError();
        assert.deepEqual(errorResult, {
            caught: true,
            message: 'Client error'
        }, 'should handle client errors');

        // Test recursive calculation
        const factorial = await client.startFactorial(5);
        assert.deepEqual(factorial, {
            input: 5,
            result: 120
        }, 'should handle recursive calls');

        // Test nested calls - string data
        const nestedString = await client.processNested('test');
        assert.deepEqual(nestedString, {
            needsMoreProcessing: false,
            data: 'Finalized: TEST'
        }, 'should handle nested string processing');

        // Test nested calls - number data
        const nestedNumber = await client.processNested(5);
        assert.deepEqual(nestedNumber, {
            needsMoreProcessing: false,
            data: 10
        }, 'should handle nested number processing');
    });

    it('should handle connection state changes', async () => {
        let peer1, peer2;
        const conn = createConnection(conn => {
            peer1 = conn;
            // Server side
            const server = open(conn, {
                opened: false,
                timeout: 3000,
                routing: {
                    test: async (a, b) => {
                        await sleep(200);
                        return a + b;
                    }
                }
            });
        }, { opened: false });  // Create a closed connection
        peer2 = conn;

        // Client side
        const client = open(peer2, {
            opened: false,
            timeout: 3000
        });

        // Test initial state (closed)
        await assert.rejects(async () => {
            await client.test(1, 2);
        }, /Connection is not open|Connection closed|Request timeout/);

        // Wait for open event
        const waitOpen = new Promise(resolve => {
            peer2.addEventListener('open', resolve);
            // Open connection
            peer2.open();
        });
        await waitOpen;
        await sleep(100);  // Extra wait to ensure state is updated

        // Test connection opened
        const result = await client.test(1, 2);
        assert.strictEqual(result, 3, 'method should work after connection opened');

        // Wait for close event
        const waitClose = new Promise(resolve => {
            peer2.addEventListener('close', resolve);
            // Close connection
            peer2.close();
        });
        await waitClose;
        await sleep(100);  // Extra wait to ensure state is updated

        // Test connection closed
        await assert.rejects(async () => {
            await client.test(1, 2);
        }, /Connection is not open|Connection closed|Request timeout/);

        // Wait for open event
        const waitReopen = new Promise(resolve => {
            peer2.addEventListener('open', resolve);
            // Reopen connection
            peer2.open();
        });
        await waitReopen;
        await sleep(100);  // Extra wait to ensure state is updated

        // Confirm can reconnect
        const result2 = await client.test(1, 2);
        assert.strictEqual(result2, 3, 'method should work after reconnection');
    });

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

    it('should handle connection recovery and retries', async () => {
        let connectionCount = 0;
        let peer2;
        const conn = createConnection(conn => {
            connectionCount++;
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    getValue: () => 'success'
                }
            });
        }, { opened: false });  // Initial state is closed
        peer2 = conn;

        const client = open(conn, {
            opened: false,
            timeout: 3000
        });

        // Call when connection is closed should enter send queue
        const promise1 = client.getValue();
        
        // Open connection
        peer2.open();
        await sleep(100);

        // Wait for result return
        const result1 = await promise1;
        assert.strictEqual(result1, 'success');

        // Close connection
        peer2.close();
        await sleep(100);

        // Call again should enter send queue
        const promise2 = client.getValue();

        // Reopen connection
        peer2.open();
        await sleep(100);

        // Wait for result return
        const result2 = await promise2;
        assert.strictEqual(result2, 'success');
    });

    it('should handle timeouts and cancellations correctly', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 1000,
                routing: {
                    slowOperation: async () => {
                        await sleep(2000); // Operation takes longer than timeout
                        return 'done';
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 1000 // Set shorter timeout
        });

        // Test timeout
        await assert.rejects(async () => {
            await client.slowOperation();
        }, /Request timeout/);
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
});
