# DRPC

A lightweight, bi-directional RPC library with support for method routing, middleware chains, and error handling.

## Features

- Bi-directional RPC communication
- Method routing with middleware support
- Handler chains with parameter modification
- Automatic reconnection
- Error handling and propagation
- Comprehensive type support
- Connection state management

## Installation

```bash
fibjs --install @instun/drpc
```

## Basic Usage

```js
const { open } = require('@instun/drpc');

// Server-side handler
const server = open(connection, {
    routing: {
        add: (a, b) => a + b,
        echo: msg => msg
    }
});

// Client-side connection
const client = open(connection);

// Make RPC calls
const result = await client.add(1, 2);  // Returns 3
const echo = await client.echo('test'); // Returns 'test'
```

## Method Routing

### Basic Routing

Methods can be organized in a nested structure:

```js
const server = open(connection, {
    routing: {
        math: {
            add: (a, b) => a + b,
            multiply: (a, b) => a * b
        },
        user: {
            profile: {
                get: id => ({ id, name: 'Test' }),
                update: (id, data) => ({ ...data, id })
            }
        }
    }
});

// Client usage
await client.math.add(1, 2);
await client.user.profile.get(123);
```

### Handler Chains

Handler chains allow you to process requests through multiple handlers, with each handler modifying the parameters before passing them to the next handler:

```js
const server = open(connection, {
    routing: {
        transform: [
            // First handler: convert to uppercase
            async function(text) {
                this.params[0] = text.toUpperCase();
            },
            // Second handler: add exclamation mark
            async function(text) {
                this.params[0] = text + '!';
            },
            // Last handler: return final result
            async function(text) {
                return `[${text}]`;
            }
        ],
        
        processNumbers: [
            // First handler: double the number
            async function(num) {
                this.params[0] = num * 2;
            },
            // Second handler: add 5
            async function(num) {
                this.params[0] = num + 5;
            },
            // Last handler: format result
            async function(num) {
                return `Result: ${num}`;
            }
        ]
    }
});

// Usage:
const result1 = await client.transform('hello');
console.log(result1); // '[HELLO!]'

const result2 = await client.processNumbers(10);
console.log(result2); // 'Result: 25' (10 * 2 + 5)
```

### Handler Chain Rules

1. Only the last handler in a chain can return a value
2. Intermediate handlers must modify parameters using `this.params`
3. Each handler has access to:
   - `this.method`: Current method path
   - `this.params`: Array of method parameters
   - `this.invoke`: For making nested RPC calls

```js
const server = open(connection, {
    routing: [
        // Middleware for logging
        async function() {
            console.log(`Called: ${this.method}`);
            console.log(`Params:`, this.params);
        },
        
        // Middleware for parameter validation
        async function() {
            if (!this.params[0]) {
                throw new Error('Missing required parameter');
            }
            // Modify parameters for next handler
            this.params[0] = { validated: true, ...this.params[0] };
        },
        
        // Final handler
        {
            process: async function(data) {
                return { result: 'success', data };
            }
        }
    ]
});
```

### Fuzzy Matching in Handler Chains

The library supports flexible method routing with fuzzy matching, where a handler can process multiple method paths using a common prefix:

```js
const server = open(connection, {
    routing: [
        function() {
            console.log(`Processing: ${this.method}`);
            this.params[0] = { ...this.params[0], processed: true };
        },
        {
            // Handle all methods under "user.*"
            "user": async function() {
                // If client calls "user.profile.get",
                // this.method will be "profile.get"
                console.log(`Processing: ${this.method}`);
                this.params[0] = { ...this.params[0], processed: true };
            },
            
            // Specific handlers still take precedence
            "user.special": async function(data) {
                return { special: true, data };
            },
            // Handle all methods under "admin.*"
            "admin": [
                function() {
                    // If client calls "admin.add_user",
                    // this.method will be "add_user"
                    console.log(`Processing: ${this.method}`);
                    this.params[0] = { ...this.params[0], processed: true };
                },
                {
                    "add_user": async function(data) {
                        return { success: true, data };
                    }   ,
                    "remove_user": async function(data) {
                        return { success: true, data };
                    }
                }
            ]
        }
    ]
});

// Example flows:
// 1. client.user.profile.get({ name: 'test' })
//    - Matches "user" handler
//    - this.method is "profile.get"
//    - Modifies params[0] to { name: 'test', processed: true }

// 2. client.user.special({ type: 'test' })
//    - Matches "user.special" handler directly
//    - Returns { special: true, data: { type: 'test' } }

// 3. client.admin.add_user({ id: 123 })
//    - Matches "admin" handler
//    - this.method is "add_user"
//    - Modifies params[0] to { id: 123, processed: true }

// 4. client.admin.remove_user({ id: 123 })
//    - Matches "admin" handler
//    - this.method is "remove_user"
//    - Modifies params[0] to { id: 123, processed: true }
```

The router will find the longest matching prefix handler, which allows for flexible routing patterns like:
- `user.*` - Handle all methods under user
- `user.profile.*` - Handle all profile-related methods
- `admin.*` - Handle all admin methods

This is particularly useful for:
- Implementing middleware for groups of methods
- API versioning
- Dynamic method handling
- Request preprocessing
- Access control by path patterns

## Bidirectional Communication

The library supports full-duplex RPC communication, allowing both server and client to initiate calls:

```js
// Server-side
const server = open(connection, {
    routing: {
        // Server method that calls client
        processWithCallback: async function(data) {
            // Call client's transformData method
            const result = await this.invoke.transformData(data);
            return `Processed: ${result}`;
        }
    }
});

// Client-side
const client = open(connection, {
    // Client exposes methods for server to call
    routing: {
        transformData: async function(data) {
            return data.toUpperCase();
        }
    }
});

// Example flow:
// 1. Client initiates call
const result = await client.processWithCallback('hello');
console.log(result); 
// Output: "Processed: HELLO"

// 2. Server can also initiate calls to client's exposed methods
// This happens automatically when server uses this.invoke
```

This enables:
- Server push notifications
- Real-time updates
- Client-side API exposure
- Callback-based workflows
- Event-driven architectures

## Connection Management

### Auto Reconnection

```js
const client = open(connection, {
    timeout: 5000,      // Request timeout
    maxRetries: 3,      // Max reconnection attempts
    retryDelay: 1000    // Delay between attempts
});
```

### Connection State

```js
// Get current connection state
const state = client[Symbol.for('drpc.state')]();

// Listen for state changes
const client = open(connection, {
    onStateChange: (oldState, newState) => {
        console.log(`Connection state changed: ${oldState} -> ${newState}`);
    }
});
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
