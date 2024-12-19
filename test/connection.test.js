const { describe, it } = require('node:test');
const assert = require('node:assert');
const events = require('events');
const { open } = require('../lib');

// Helper function for sleeping
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Symbol for state
const symbol_state = Symbol.for("drpc.state");

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

describe('Connection Management Tests', () => {
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

    it('should handle connection recovery and retries', async () => {
        let connectionCount = 0;
        let peer2;
        const conn = createConnection(conn => {
            connectionCount++;
            const server = open(conn, {
                opened: true,
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

    it('should handle connection factory function', async () => {
        let serverPeer, clientPeer;

        // Create a connection factory function that returns a paired connection
        function mq_connect(handler) {
            const peer1 = new events.EventEmitter();
            const peer2 = new events.EventEmitter();

            // Set up bidirectional communication using bind
            peer1.send = peer2.emit.bind(peer2, 'message');
            peer2.send = peer1.emit.bind(peer1, 'message');

            // Add event listeners
            peer1.addEventListener = (event, handler) => {
                if (event === 'open') {
                    handler();
                }
                peer1.on(event, handler);
            };
            peer2.addEventListener = (event, handler) => {
                if (event === 'open') {
                    handler();
                }
                peer2.on(event, handler);
            };

            // Store peers for later use
            serverPeer = peer1;
            clientPeer = peer2;

            return peer1;
        }

        // Create server using the connection factory
        const server = open(() => mq_connect(), {
            opened: true,
            routing: {
                test: async function (v1, v2) {
                    await sleep(200);
                    return v1 + v2;
                },
                "test.test1": async function (v1, v2) {
                    await sleep(200);
                    return v1 + v2;
                }
            }
        });

        // Create client using the stored peer
        const client = open(clientPeer, {
            opened: true
        });

        // Test the connection
        const result = await client.test(1, 2);
        assert.strictEqual(result, 3, 'should work with factory created connection');

        const nestedResult = await client['test.test1'](3, 4);
        assert.strictEqual(nestedResult, 7, 'should work with nested methods');
    });
});
