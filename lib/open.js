const response = require("./isomorph/response");
const async_event = require("@instun/event");

const symbol_conn = Symbol.for("conn");
const symbol_state = Symbol.for("drpc.state");
const symbol_cache = Symbol.for("drpc.method_cache");

/**
 * Resolve method from routing object based on method name with dot notation
 * Supports hierarchical method names like 'namespace.method' or 'a.b.c'
 * Will try to match the longest possible prefix if exact match is not found
 * @param {Object} routing Method routing configuration
 * @param {string} method Method name with dot notation
 * @returns {Function|undefined} Resolved method or undefined if not found
 */
function resolve_method(routing, method) {
    // fetch or create method cache
    if (!routing[symbol_cache]) {
        routing[symbol_cache] = new Map();
    }
    const methodCache = routing[symbol_cache];

    // get method from cache
    const cacheKey = method;
    if (methodCache.has(cacheKey)) {
        return methodCache.get(cacheKey);
    }

    let r = routing;
    var methods = method.split('.');

    do {
        if (typeof r !== 'object')
            return;

        if (methods.length == 1) {
            r = r[methods[0]];
            break;
        }

        for (var l = methods.length; l > 0; l--) {
            const _method = methods.slice(0, l).join('.');

            var r1 = r[_method];
            if (r1) {
                r = r1;
                methods = methods.slice(l);
                break;
            }
        }

        if (l == 0)
            return;
    } while (methods.length > 0);

    if (typeof r !== 'function')
        return;

    // cache resolved method
    methodCache.set(cacheKey, r);
    return r;
}

/**
 * Open and manage a RPC connection
 * Supports bi-directional RPC calls with timeout and error handling
 * Features:
 * - Request/Response correlation using message IDs
 * - Automatic timeout handling
 * - Error propagation with JSON-RPC error codes
 * - Support for notification (fire-and-forget) pattern
 * @param {Object} conn Connection object with send() and message handlers
 * @param {Object} [opts] Options
 * @param {number} [opts.timeout=10000] Request timeout in ms
 * @param {boolean} [opts.opened=false] Whether connection is opened
 * @param {Object} [opts.routing={}] Method routing configuration
 */
const open = function (conn, opts = {}) {
    const timeout = opts.timeout || 10000;
    const routing = opts.routing || {};
    const maxRetries = opts.maxRetries || 3;
    const retryDelay = opts.retryDelay || 1000;

    // Connection states
    const STATE = {
        INIT: 'INIT',
        CONNECTING: 'CONNECTING',
        CONNECTED: 'CONNECTED',
        RECONNECTING: 'RECONNECTING',
        CLOSED: 'CLOSED'
    };

    var id = 0;
    var rq = {};
    var rq_cnt = 0;
    var sq = {};
    var sq_cnt = 0;
    var send;
    var is_open = !!opts.opened;
    var retryCount = 0;
    var currentState = 'INIT';
    var stateChangeCallback = opts.onStateChange;

    function setState(newState) {
        if (currentState === newState) return;
        const oldState = currentState;
        currentState = newState;
        if (stateChangeCallback) {
            stateChangeCallback(oldState, newState);
        }
    }

    /**
     * Clean up request resources and send result
     * @param {Object} o Request object
     * @param {Object} v Result value
     */
    function send_result(o, v) {
        if (rq[o.r.id]) {
            delete rq[o.r.id];
            rq_cnt--;
        } else if (sq[o.r.id]) {
            delete sq[o.r.id];
            sq_cnt--;
        }

        o.v = v;
        clearTimeout(o.t);
        o.e.set();
    }

    /**
     * Process incoming RPC message
     * @param {Object} o Message object
     * @returns {Object} Response object
     */
    async function invoke(o) {
        let method = o.method;
        let params = o.params;
        if (params === undefined)
            params = [];
        if (!Array.isArray(params))
            return response.setRpcError(o.id, -32602);

        var f = resolve_method(routing, method);
        if (!f)
            return response.setRpcError(o.id, -32601);

        let r;
        try {
            r = await f.apply(_method, params);
        }
        catch (e) {
            // If error object already contains error code, use it directly
            if (e.code) {
                return response.setRpcError(o.id, e.code, e.message, e.data);
            }
            return response.handleError(o.id, e);
        }

        return {
            id: o.id,
            result: r
        };
    };

    var open;
    if (typeof conn === 'function') {
        open = conn;
        conn = open();
    }

    /**
     * Initialize connection and set up handlers
     * Sets up event listeners for connection state changes and message handling
     * Handles connection close/error events and message queuing
     */
    function start() {
        setState('CONNECTING');
        send = conn.postMessage ? conn.postMessage.bind(conn) : conn.send.bind(conn);

        // Handle different event listener APIs (addEventListener, addListener, on)
        const addEventListener = conn.addEventListener ?
            conn.addEventListener.bind(conn) :
            conn.addListener ?
                conn.addListener.bind(conn) :
                conn.on.bind(conn);

        var is_closed = false;
        function on_close() {
            if (!is_closed) {
                is_closed = true;
                for (const r in rq)
                    send_result(rq[r], response.setRpcError(rq[r].r.id, -32000, "Connection closed"));
                
                if (retryCount < maxRetries) {
                    setState('RECONNECTING');
                    retryCount++;
                    setTimeout(() => {
                        if (currentState === 'RECONNECTING') {  
                            if (open) {
                                conn = open();
                                start();
                            } else {
                                setState('CLOSED');
                            }
                        }
                    }, retryDelay);
                } else {
                    setState('CLOSED');
                }
            }
        }

        addEventListener("close", on_close);
        addEventListener("exit", on_close);
        addEventListener("error", on_close);

        addEventListener("open", (m) => {
            retryCount = 0;
            for (const r in sq) {
                const o = sq[r];
                send(JSON.stringify(o.r));
                rq[o.r.id] = o;
                rq_cnt++;
            }
            sq = {};
            sq_cnt = 0;

            is_open = true;
            setState('CONNECTED');
        });

        // Handle incoming messages
        addEventListener("message", async (msg) => {
            // Normalize message data
            if (typeof msg !== "string")
                msg = msg.data;
            const v = JSON.parse(msg);

            // Process method invocations and responses
            if (typeof v.method === 'string') {
                // Handle method invocation
                send(JSON.stringify(await invoke(v)));
            } else {
                // Handle response to previous request
                const o = rq[v.id];
                if (o === undefined) {
                    return;
                }

                send_result(o, v);
            }
        });
    }

    start();

    /**
     * Create a proxy object for method invocation with namespace support
     * Handles both direct method calls and nested namespace access
     * Supports timeout, error handling, and connection state management
     * @param {string} base Base namespace for the method
     * @param {string} name Method name
     * @returns {Proxy} Method proxy that handles invocation and namespace access
     */
    function method_func(base, name) {
        // Construct full method name with namespace
        const func_name = base === "" ? name : `${base}.${name}`;

        return new Proxy(async function () {
            // Generate unique request ID and prepare parameters
            const _id = id++;
            const params = Array.prototype.slice.call(arguments, 0);
            const o = {
                r: {
                    id: _id,
                    method: func_name,
                    params: params
                },
                // Set up timeout handler
                t: setTimeout(() => send_result(o, response.setRpcError(o.r.id, -32001, "Request timeout")), timeout),
                e: async_event()
            };

            try {
                // Verify connection state
                if (!is_open)
                    throw new Error("Connection is not open");

                // Send request
                send(JSON.stringify(o.r));

                // Track request in response queue
                rq[_id] = o;
                rq_cnt++;
            }
            catch (e) {
                // Queue request if send fails
                sq[_id] = o;
                sq_cnt++;
            }

            // Wait for response
            await o.e.wait();

            // Handle error response
            if (o.v.error) {
                const error = new Error(o.v.error.message);
                error.code = o.v.error.code;
                error.type = o.v.error.type;
                error.data = o.v.error.data;
                throw error;
            }

            return o.v.result;
        }, {
            // Handle property access for nested namespaces
            get: (target, name) => {
                if (name === symbol_conn)
                    return conn;
                if (!(name in target))
                    return target[name] = method_func(func_name, name);
                return target[name];
            },
            // Prevent property modification
            set: (target, name, value) => {
                throw new Error(`"${name}" is read-only.`);
            }
        });
    }

    const _method = method_func("", "");
    Object.defineProperty(_method, symbol_state, {
        enumerable: false,
        configurable: false,
        writable: false,
        value: () => currentState
    });
    return _method;
};

module.exports = open;
