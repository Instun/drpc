# DRPC

A lightweight, bi-directional RPC library for Node.js and fibjs.

## Features

- Bi-directional RPC communication
- Flexible method routing with middleware support
- Handler chains with parameter transformation
- Automatic connection management
- Comprehensive TypeScript support
- Built-in error handling and propagation

## Installation

Install DRPC library using the fibjs package manager. Compatible with both Node.js and fibjs environments.

```bash
fibjs --install @instun/drpc
```

## Basic Usage

RPC enables seamless communication between services:
- Service Discovery: Automatically find and connect to services
- API Gateway: Act as an entry point for microservices
- Load Balancing: Distribute requests across multiple servers
- Protocol Translation: Bridge different communication protocols

DRPC enables bi-directional communication between server and client. The server defines methods that clients can call directly as if they were local functions.

```js
const { open } = require('@instun/drpc');

// Server setup
const server = open(connection, {
  routing: {
    add: (a, b) => a + b,
    echo: msg => msg
  }
});

// Client setup
const client = open(connection);

// Making RPC calls
const sum = await client.add(1, 2);    // Returns: 3
const msg = await client.echo('test'); // Returns: 'test'
```

## Method Routing

### Basic Routing

Organize your APIs with nested routing for:
- Resource Management: Group related resources
- Version Control: Manage API versions
- Access Control: Route-based permissions
- Service Aggregation: Combine multiple backend services

The routing system supports nested method definitions, allowing you to organize related methods under the same namespace. For example, group all math operations under `math` and user-related methods under `user`.

```js
const server = open(connection, {
  routing: {
    math: {
      add: (a, b) => a + b,
      multiply: (a, b) => a * b
    },
    user: {
      get: id => ({ id, name: 'User' }),
      update: (id, data) => ({ ...data, id })
    }
  }
});

// Client usage
const sum = await client.math.add(1, 2);
const user = await client.user.get(123);
```

### Handler Chains

Transform and process requests through multiple stages:
- Data Pipeline: Multi-step data transformations
- Authentication: Multi-layer security checks
- Format Conversion: Transform between different data formats
- Audit Trail: Track changes through processing stages
- Rate Limiting: Control request flow at different stages

Handler chains allow processing a request through multiple handlers. Each handler can modify parameters before passing them to the next handler, with the final handler returning the result. This is particularly useful for implementing data transformation, validation, logging, and more.

```js
const server = open(connection, {
  routing: {
    process: [
      // Transform input
      async function(text) {
        this.params[0] = text.toUpperCase();
      },
      // Add suffix
      async function(text) {
        this.params[0] = `${text}!`;
      },
      // Final handler
      async function(text) {
        return `[${text}]`;
      }
    ]
  }
});

// Usage
const result = await client.process('hello');
// Returns: '[HELLO!]'
```

### Middleware Support

Common middleware applications:
- Request Logging: Track all API calls
- Performance Monitoring: Measure response times
- Circuit Breaking: Prevent cascade failures
- Request Correlation: Track requests across services
- Caching: Cache responses at different levels
- Error Handling: Centralize error processing

Middleware provides a unified way to process requests. Use middleware to implement:
- Request logging
- Parameter validation
- Error handling
- Access control
- Performance monitoring

```js
const server = open(connection, {
  routing: [
    // Logging middleware
    async function() {
      console.log(`Method: ${this.method}`);
      console.log(`Params:`, this.params);
    },
    
    // Validation middleware
    async function() {
      const data = this.params[0];
      if (!data) throw new Error('Invalid input');
      this.params[0] = { validated: true, ...data };
    },
    
    // Route handlers
    {
      'user.create': async function(data) {
        return { success: true, user: data };
      },
      'user.delete': async function(id) {
        return { success: true, id };
      }
    }
  ]
});
```

### Fuzzy Matching in Handler Chains

The library supports flexible method routing with fuzzy matching, allowing handlers to process multiple method paths using common prefixes. This feature enables:
- Group-level middleware implementation
- Dynamic route handling
- Pattern-based access control
- API version management
- Request preprocessing by path patterns
- Hierarchical route organization

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
            
            // Specific handlers take precedence
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
                    },
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
//    - Matches "admin" handler chain
//    - Processes through middleware first
//    - Finally calls specific add_user handler

// 4. client.admin.remove_user({ id: 123 })
//    - Similar to add_user flow
//    - Uses remove_user handler after middleware
```

The router uses longest-prefix matching to find the most specific handler:
- `user.*` matches all user-related methods
- `user.profile.*` matches profile-specific methods
- `admin.*` matches all admin methods
- Exact matches take precedence over wildcards

This pattern enables:
- Hierarchical API organization
- Granular access control
- Common preprocessing for method groups
- Version-specific handling
- Dynamic route management

## Context Management

DRPC provides two types of context management:

### Handler Context

Handler context is designed for request-scoped data sharing with these key features:
- Scope: Limited to a single request's handler chain
- Lifetime: From request start to response completion
- Storage: In-memory, cleared after each request
- Use Cases:
  - Request timing and metrics
  - Request-specific configuration
  - Step-by-step data transformation
  - Request validation state
  - Temporary data caching

Example: Multi-step data processing with context
```js
const server = open(connection, {
  routing: {
    processOrder: [
      // Validation step
      async function(order) {
        this.context = {
          startTime: Date.now(),
          validations: []
        };
        
        // Validate order
        if (!order.items?.length) {
          throw new Error('Empty order');
        }
        this.context.validations.push('items');
        
        // Pass validated order to next handler
        this.params[0] = order;
      },
      // Processing step
      async function(order) {
        // Calculate total
        const total = order.items.reduce((sum, item) => sum + item.price, 0);
        this.context.validations.push('pricing');
        
        // Update order with total
        this.params[0] = { ...order, total };
      },
      // Final step with audit
      async function(order) {
        return {
          order,
          audit: {
            processTime: Date.now() - this.context.startTime,
            validations: this.context.validations
          }
        };
      }
    ]
  }
});
```

### Connection Context

Connection context (`this.invoke[]`) provides persistent data storage across the entire connection lifecycle:

- Scope: Connection-wide, shared across all requests
- Lifetime: Persists until connection closes
- Storage: Symbol-keyed storage for safety
- Use Cases:
  - User authentication state
  - Session management
  - Connection configuration
  - Cached data
  - Resource pooling

Example: Authentication and session management
```js
const AUTH_KEY = Symbol('auth');
const SESSION_KEY = Symbol('session');

const server = open(connection, {
  routing: {
    auth: {
      // Login and store session
      login: async function(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error('Invalid credentials');
        }
        
        // Store auth state in connection context
        this.invoke[AUTH_KEY] = {
          username: credentials.username,
          roles: ['user'],
          loginTime: Date.now()
        };
        
        // Initialize session data
        this.invoke[SESSION_KEY] = {
          lastAccess: Date.now(),
          activities: []
        };
        
        return { success: true };
      },

      // Protected resource access using stored context
      getData: async function() {
        const auth = this.invoke[AUTH_KEY];
        if (!auth) throw new Error('Unauthorized');
        
        const session = this.invoke[SESSION_KEY];
        session.lastAccess = Date.now();
        session.activities.push('getData');
        
        return {
          data: 'sensitive data',
          actor: auth.username
        };
      },

      // Clear context on logout
      logout: async function() {
        delete this.invoke[AUTH_KEY];
        delete this.invoke[SESSION_KEY];
        return { success: true };
      }
    }
  }
});
```

Key benefits of connection context:
- Built-in connection lifecycle management
- Automatic cleanup when connection closes
- Symbol-based security
- Simple and direct API
- Natural integration with middleware chains

## Bi-directional Communication

DRPC supports full-duplex communication where both server and client can initiate calls. This enables easy implementation of:
- Server push notifications
- Real-time updates
- Two-way data synchronization
- Callback-based APIs

```js
// Server
const server = open(connection, {
  routing: {
    async notify(message) {
      // Call client's onNotify method
      await this.invoke.onNotify(message);
      return true;
    }
  }
});

// Client
const client = open(connection, {
  routing: {
    onNotify: message => {
      console.log('Received:', message);
    }
  }
});
```

## Connection Management

DRPC provides comprehensive connection lifecycle management:
- Automatic reconnection
- Timeout control
- Maximum retry attempts
- Retry delay
- Connection state monitoring

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

## Error Handling

The error handling system supports:
- Request timeout handling
- Connection loss handling
- Business error processing
- Error propagation
- Error recovery

```js
try {
  await client.someMethod();
} catch (err) {
  if (err.code === 'TIMEOUT') {
    // Handle timeout
  } else if (err.code === 'DISCONNECTED') {
    // Handle connection error
  } else {
    // Handle other errors
  }
}
```

## License

MIT © [Instun](https://github.com/instun)
