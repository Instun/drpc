# @instun/drpc

## Overview

@instun/drpc is a lightweight, flexible, and efficient library for handling JSON-RPC communication across various JavaScript environments. Built with a focus on performance and reliability, it provides a unified interface for remote procedure calls in web browsers, Node.js, Fibjs, and React Native applications. The library supports a wide range of connection objects, including WebSocket, WebRTC, IPC, Worker, and custom message queues, making it versatile enough for everything from real-time web applications to complex server-side systems.

## Features

- **Cross-Platform Support**
  - Web browsers (modern and legacy)
  - Node.js and Fibjs environments
  - React Native compatibility
  - Electron and NW.js support
  - Universal module support (UMD)

- **Transport Layer Support**
  - WebSocket integration
  - WebRTC data channels
  - Inter-process communication (IPC)
  - Web Workers messaging
  - Custom transport protocols

- **Development Experience**
  - Simple and intuitive API
  - Comprehensive documentation
  - Built-in testing utilities
  - TypeScript support
  - Debugging tools

- **Security**
  - Input validation
  - Request sanitization
  - Rate limiting support
  - Timeout handling
  - Session management

## Installation

You can install @instun/drpc via npm:

```sh
npm install @instun/drpc
```

## Usage Guide

### Basic Setup

The library provides a clean and intuitive API for both client and server implementations. You can quickly set up RPC communication with just a few lines of code:

```js
const rpc = require('@instun/drpc');
const ws = require('ws');
const http = require('http');

// Server setup
const server = new http.Server(8811, ws.upgrade(rpc.handler({
    add: async (a, b) => a + b,
    user: {
        profile: {
            get: async (userId) => ({ id: userId, name: 'John' })
        }
    }
})));

// Client setup
const client = rpc.open(() => new ws.Socket('ws://127.0.0.1:8811'), {
    timeout: 5000,
    maxRetries: 3
});

// Make RPC calls
const sum = await client.add(1, 2);
const profile = await client.user.profile.get(123);
```

### Method Routing and Chain Mode

@instun/drpc provides a powerful routing system that supports both traditional method routing and chain mode processing:

#### Basic Method Routing

Method routing in @instun/drpc provides a flexible way to organize your RPC endpoints:

```js
const server = rpc.handler({
    // Basic methods
    add: async (a, b) => a + b,
    multiply: async (a, b) => a * b,

    // Nested namespaces
    user: {
        profile: {
            get: async (userId) => ({ id: userId, name: 'John' }),
            update: async (userId, data) => ({ success: true })
        }
    }
});
```

#### Chain Mode Processing

Chain mode extends the basic routing by allowing handlers to modify parameters and share state:

- **Parameter Modification**
  - Use `this.method` to modify parameters for the next handler in the chain
  - Transform and validate data between handlers
  - Control the flow of data through the chain

- **State Management**
  - Use `this.invoke[]` to share data between different calls
  - Maintain connection-specific context
  - Store session data like authentication tokens

Example of chain mode:

```js
const server = rpc.handler({
    user: {
        // First handler in chain
        validate: async function(userId, data) {
            if (!this.invoke['session']) {
                throw new Error('No session');
            }
            // Modify parameters for the next handler
            this.method = [userId, { ...data, validated: true }];
        },
        
        // Second handler receives modified parameters
        process: async function(userId, data) {
            console.log(data.validated); // true
            const result = await processUser(userId, data);
            // Pass processed result to next handler
            this.method = [result];
        },
        
        // Final handler in chain
        respond: async function(result) {
            return {
                success: true,
                data: result,
                session: this.invoke['session']
            };
        }
    },

    auth: {
        login: async function(credentials) {
            const session = await authenticate(credentials);
            // Store session for other calls
            this.invoke['session'] = session;
            return { success: true };
        }
    }
});
```

In this example:
1. The `validate` handler checks the session and enhances the input data
2. The `process` handler receives the modified parameters and processes them
3. The `respond` handler formats the final response with session information
4. The `auth.login` handler demonstrates how to share session state between different calls

### Bidirectional Communication

The library supports full-duplex RPC communication, allowing both server and client to initiate calls. This enables:
- Server push notifications
- Real-time updates
- Client-side API exposure
- Callback-based workflows
- Event-driven architectures

Example implementation:

```js
// Server-side
const server = rpc.handler({
    notify: async function(message) {
        // Call client's method
        const response = await this.invoke.receive(message);
        return `Sent: ${message}, Response: ${response}`;
    }
});

// Client-side
const client = rpc.open(connection, {
    routing: {
        receive: async (message) => {
            console.log('Received:', message);
            return 'Message acknowledged';
        }
    }
});
```

### State Management

The connection state management system provides:
- Automatic connection recovery
- Event-based state notifications
- Configurable retry strategies
- Connection pooling
- Session persistence

Example implementation:

```js
const client = rpc.open(connection, {
    // Connection configuration
    timeout: 5000,
    maxRetries: 3,
    retryDelay: 1000,

    // State management
    onStateChange: (oldState, newState) => {
        console.log(`State: ${oldState} -> ${newState}`);
        switch (newState) {
            case 'CONNECTED':
                console.log('Connection established');
                break;
            case 'RECONNECTING':
                console.log('Attempting to reconnect...');
                break;
            case 'CLOSED':
                console.log('Connection closed');
                break;
        }
    }
});
```

### Error Handling

The error handling system provides comprehensive error management with:
- Standard JSON-RPC error codes
- Custom error types and codes
- Enhanced error information
- Error stack preservation
- Type-specific error handling

Example implementation:

```js
const server = rpc.handler({
    // Basic error throwing
    throwError: () => {
        throw new Error('Operation failed');
    },

    // Custom error with additional information
    validateUser: (user) => {
        const error = new Error('Invalid user data');
        error.code = -32098;  // Custom error code
        error.data = { field: 'email', reason: 'invalid format' };
        throw error;
    },

    // Custom error types
    handleRequest: (type) => {
        class ValidationError extends Error {
            constructor(message) {
                super(message);
                this.name = 'ValidationError';
                this.code = -32099;
                this.data = { type: 'validation' };
            }
        }

        switch (type) {
            case 'validation':
                throw new ValidationError('Invalid input');
            case 'type':
                throw new TypeError('Invalid type');
            default:
                throw new Error('Unknown error');
        }
    }
});

// Client-side error handling
try {
    await client.validateUser({ email: 'invalid' });
} catch (error) {
    // Standard JSON-RPC error codes
    switch (error.code) {
        case -32700: console.log('Parse error');
        case -32600: console.log('Invalid request');
        case -32601: console.log('Method not found');
        case -32602: console.log('Invalid params');
        case -32603: console.log('Internal error');
        default:     console.log('Custom error:', error.code);
    }

    // Access error details
    console.log(error.message);  // Error message
    console.log(error.code);     // Error code
    console.log(error.data);     // Additional error data
    console.log(error.stack);    // Error stack trace
}
```

### Data Type Handling

The library provides comprehensive support for JavaScript data types:
- Date objects and timestamps
- Special values (Infinity, NaN, undefined)
- Complex nested objects
- Sparse arrays
- Custom serialization

Example implementation:

```js
const server = rpc.handler({
    process: async () => {
        return {
            // Date objects
            timestamp: new Date(),
            
            // Special values
            special: {
                inf: Infinity,
                nan: NaN,
                undef: undefined
            },
            
            // Arrays and objects
            array: [1, , 3],      // Sparse array
            nested: {
                deep: {
                    value: 1
                }
            },
            
            // Custom serialization
            custom: {
                toJSON() {
                    return 'serialized';
                }
            }
        };
    }
});
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

For any questions or feedback, please open an issue on our [GitHub repository](https://github.com/Instun/drpc).
