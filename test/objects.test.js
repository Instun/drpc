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

describe('Complex Objects Tests', () => {
    it('should handle echo of complex objects', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Return passed object
                    echo: obj => obj
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
    });

    it('should handle various data types', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
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
                    })
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

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
    });

    it('should handle array operations', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    // Process array operations
                    processArray: arr => ({
                        length: arr.length,
                        sum: arr.reduce((a, b) => a + b, 0),
                        doubled: arr.map(x => x * 2)
                    })
                }
            });
        }, { opened: true });

        // Client side
        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        // Test array operations
        const arrayResult = await client.processArray([1, 2, 3, 4, 5]);
        assert.strictEqual(arrayResult.length, 5, 'should handle array length');
        assert.strictEqual(arrayResult.sum, 15, 'should handle array reduction');
        assert.deepEqual(arrayResult.doubled, [2, 4, 6, 8, 10], 'should handle array mapping');
    });

    it('should handle object merging', async () => {
        const conn = createConnection(conn => {
            // Server side
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
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

    it('should handle JSON special values', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    getSpecialValues: () => ({
                        infinity: Infinity,
                        negInfinity: -Infinity,
                        nan: NaN,
                        undefined: undefined,
                        function: function() {},
                        symbol: Symbol('test')
                    })
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        const result = await client.getSpecialValues();
        assert.strictEqual(result.infinity, null, 'Infinity should be serialized as null');
        assert.strictEqual(result.negInfinity, null, '-Infinity should be serialized as null');
        assert.strictEqual(result.nan, null, 'NaN should be serialized as null');
        assert.strictEqual(result.undefined, undefined, 'undefined should remain undefined');
        assert.strictEqual(result.function, undefined, 'function should be stripped during serialization');
        assert.strictEqual(result.symbol, undefined, 'symbol should be stripped during serialization');
    });

    it('should handle large nested objects within JSON size limits', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    processNested: obj => {
                        // Recursively calculate nested depth
                        function getDepth(obj) {
                            if (typeof obj !== 'object' || obj === null) return 0;
                            return 1 + Math.max(
                                ...Object.values(obj).map(v => getDepth(v))
                            );
                        }
                        return {
                            depth: getDepth(obj),
                            keys: Object.keys(obj).length,
                            hasCircular: false // JSON does not support circular references
                        };
                    }
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        const nestedObj = {
            a: {
                b: {
                    c: {
                        d: {
                            e: 1
                        }
                    }
                }
            },
            x: {
                y: [1, { z: 2 }]
            }
        };

        const result = await client.processNested(nestedObj);
        assert.strictEqual(result.depth, 5, 'should correctly calculate nested depth');
        assert.strictEqual(result.keys, 2, 'should correctly count top-level keys');
        assert.strictEqual(result.hasCircular, false, 'should not have circular references');
    });

    it('should handle array-like objects and sparse arrays', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    processArrays: obj => ({
                        // JSON.stringify converts sparse array holes to null
                        sparse: obj.sparse,
                        // Array-like objects remain as plain objects
                        arrayLike: obj.arrayLike,
                        // Filter out null and undefined
                        noHoles: obj.sparse.filter(x => x != null)
                    })
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        const sparseArray = [];
        sparseArray[0] = 1;
        sparseArray[2] = 3;
        sparseArray[5] = 6;

        const input = {
            sparse: sparseArray,
            arrayLike: { 0: 'a', 1: 'b', length: 2 }
        };

        const result = await client.processArrays(input);
        // JSON-RPC converts sparse array holes to null
        assert.deepEqual(result.sparse, [1, null, 3, null, null, 6], 'sparse array holes should become null');
        // Array-like objects remain as objects
        assert.deepEqual(result.arrayLike, { 0: 'a', 1: 'b', length: 2 }, 'array-like object should remain as object');
        // Filter out null and undefined
        assert.deepEqual(result.noHoles, [1, 3, 6], 'null and undefined should be filtered out');
    });

    it('should handle toJSON and property getters', async () => {
        const conn = createConnection(conn => {
            const server = open(conn, {
                opened: true,
                timeout: 3000,
                routing: {
                    processCustomJSON: obj => obj
                }
            });
        }, { opened: true });

        const client = open(conn, {
            opened: true,
            timeout: 3000
        });

        const input = {
            normal: 'value',
            toJSON() {
                return { serialized: true };
            },
            get computed() {
                return 42;
            }
        };

        const result = await client.processCustomJSON(input);
        assert.deepEqual(result, { serialized: true }, 'toJSON method should be used for serialization');
        
        const dateInput = new Date('2024-12-20T04:10:52+08:00');
        const dateResult = await client.processCustomJSON(dateInput);
        assert.strictEqual(dateResult, dateInput.toISOString(), 'Date should be serialized to ISO string');
    });
});
