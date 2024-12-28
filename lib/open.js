/**
 * @fileoverview RPC connection management and method routing implementation.
 * Provides bi-directional RPC communication with support for method routing, middleware chains,
 * error handling, timeouts, and automatic reconnection.
 */

const response = require("./isomorph/response");
const AsyncEvent = require("@instun/event");
const wrapMethodHandler = require("./methodHandler");

// Symbols for internal use
const CONNECTION_SYMBOL = Symbol.for("conn");  // Symbol to access the underlying connection
const STATE_SYMBOL = Symbol.for("drpc.state"); // Symbol to access connection state

/**
 * Opens and manages a bi-directional RPC connection.
 * Provides a rich set of features for RPC communication:
 * - Request/Response correlation using message IDs
 * - Automatic timeout handling
 * - Error propagation with JSON-RPC error codes
 * - Support for notification (fire-and-forget) pattern
 * - Automatic reconnection with configurable retries
 * - Method routing with middleware support
 * - Connection state management
 * 
 * @param {Object|Function} connection - Connection object or factory function
 * @param {Object} [connectionConfig] - Connection configuration options
 * @param {number} [connectionConfig.timeout=10000] - Request timeout in milliseconds
 * @param {boolean} [connectionConfig.opened=false] - Whether connection is initially opened
 * @param {Object} [connectionConfig.routing={}] - Method routing configuration
 * @param {number} [connectionConfig.maxRetries=3] - Maximum reconnection attempts
 * @param {number} [connectionConfig.retryDelay=1000] - Delay between reconnection attempts
 * @param {Function} [connectionConfig.onStateChange] - Callback for connection state changes
 * @returns {Proxy} A proxy object for making RPC calls
 */
const open = function (connection, connectionConfig = {}) {
    const requestTimeout = connectionConfig.timeout || 10000;
    const methodHandler = wrapMethodHandler(connectionConfig.routing || {});
    const maxReconnectAttempts = connectionConfig.maxRetries || 3;
    const reconnectDelay = connectionConfig.retryDelay || 1000;

    // Connection state constants
    const STATE = {
        INIT: 'INIT',           // Initial state
        CONNECTING: 'CONNECTING', // Attempting to connect
        CONNECTED: 'CONNECTED',   // Successfully connected
        RECONNECTING: 'RECONNECTING', // Attempting to reconnect
        CLOSED: 'CLOSED'         // Connection closed
    };

    // Internal state tracking
    var messageCounter = 0;              // Unique ID for each message
    var pendingRequests = {};            // Track active requests
    var pendingRequestCount = 0;         // Count of active requests
    var pendingSubscriptions = {};       // Track requests waiting for reconnection
    var pendingSubscriptionCount = 0;    // Count of pending subscriptions
    var sendMessage;                     // Function to send messages
    var isConnectionOpen = !!connectionConfig.opened;  // Connection state flag
    var reconnectAttempts = 0;          // Current reconnection attempt count
    var currentState = 'INIT';          // Current connection state
    var stateChangeCallback = connectionConfig.onStateChange;  // State change callback

    /**
     * Updates the connection state and triggers the state change callback
     * @param {string} state - New connection state
     */
    function updateConnectionState(state) {
        if (state !== currentState) {
            const oldState = currentState;
            currentState = state;
            if (stateChangeCallback)
                stateChangeCallback(oldState, state);
        }
    }

    /**
     * Handles completion of an RPC request
     * Cleans up resources and notifies waiters
     * @param {Object} pendingRequest - Request object
     * @param {Object} responseData - Response data
     */
    function handleResponse(pendingRequest, responseData) {
        // Clean up request tracking
        if (pendingRequests[pendingRequest.request.id]) {
            delete pendingRequests[pendingRequest.request.id];
            pendingRequestCount--;
        } else if (pendingSubscriptions[pendingRequest.request.id]) {
            delete pendingSubscriptions[pendingRequest.request.id];
            pendingSubscriptionCount--;
        }

        // Set response and notify waiters
        pendingRequest.response = responseData;
        clearTimeout(pendingRequest.timeoutHandle);
        pendingRequest.eventEmitter.set();
    }

    /**
     * Processes incoming RPC messages
     * Handles both method invocations and responses
     * @param {Object} rpcMessage - Incoming RPC message
     * @returns {Object} Response object for method invocations
     */
    async function invoke(rpcMessage) {
        try {
            const callMessage = {
                ...rpcMessage,
                invoke: methodProxy  // Allow handlers to make nested calls
            };
            const result = await methodHandler.apply(callMessage, rpcMessage.params);
            return {
                id: rpcMessage.id,
                result: result === undefined ? null : result
            };
        }
        catch (error) {
            // Preserve error information if available
            if (error.code) {
                return response.setRpcError(rpcMessage.id, error.code, error.message, error.data);
            }
            return response.handleError(rpcMessage.id, error);
        }
    };

    // Handle connection factory function
    var open;
    if (typeof connection === 'function') {
        open = connection;
        connection = open();
    }

    /**
     * Initializes the connection and sets up event handlers
     * Manages connection lifecycle and message processing
     */
    function start() {
        updateConnectionState('CONNECTING');
        sendMessage = connection.postMessage ? connection.postMessage.bind(connection) : connection.send.bind(connection);

        // Handle different event listener APIs
        const addEventListener = connection.addEventListener ?
            connection.addEventListener.bind(connection) :
            connection.addListener ?
                connection.addListener.bind(connection) :
                connection.on.bind(connection);

        var isConnectionClosed = false;

        /**
         * Handles connection close events
         * Manages reconnection attempts and error notifications
         */
        function handleConnectionClose() {
            if (!isConnectionClosed) {
                isConnectionClosed = true;

                // Notify all pending requests of connection closure
                for (const requestId in pendingRequests)
                    handleResponse(pendingRequests[requestId], response.setRpcError(pendingRequests[requestId].request.id, -32000, "Connection closed"));

                // Attempt reconnection if allowed
                if (reconnectAttempts < maxReconnectAttempts) {
                    updateConnectionState('RECONNECTING');
                    reconnectAttempts++;
                    setTimeout(() => {
                        if (currentState === 'RECONNECTING') {
                            if (open) {
                                connection = open();
                                start();
                            } else {
                                updateConnectionState('CLOSED');
                            }
                        }
                    }, reconnectDelay);
                } else {
                    updateConnectionState('CLOSED');
                }
            }
        }

        /**
         * Handles successful connection
         * Resubmits pending requests
         */
        function handleConnectionOpen() {
            reconnectAttempts = 0;

            // Resubmit pending subscriptions
            for (const requestId in pendingSubscriptions) {
                const requestObj = pendingSubscriptions[requestId];
                sendMessage(JSON.stringify(requestObj.request));
                pendingRequests[requestObj.request.id] = requestObj;
                pendingRequestCount++;
            }
            pendingSubscriptions = {};
            pendingSubscriptionCount = 0;

            isConnectionOpen = true;
            updateConnectionState('CONNECTED');
        }

        /**
         * Handles incoming messages
         * Processes both method invocations and responses
         */
        async function handleMessage(messageEvent) {
            // Normalize message data
            if (typeof messageEvent !== "string")
                messageEvent = messageEvent.data;
            const messagePayload = JSON.parse(messageEvent);

            // Process method invocations and responses
            if (typeof messagePayload.method === 'string') {
                // Handle method invocation
                sendMessage(JSON.stringify(await invoke(messagePayload)));
            } else {
                // Handle response to previous request
                const pendingRequest = pendingRequests[messagePayload.id];
                if (pendingRequest === undefined) {
                    return;
                }

                handleResponse(pendingRequest, messagePayload);
            }
        }

        // Set up event listeners for connection lifecycle
        addEventListener("close", handleConnectionClose);
        addEventListener("exit", handleConnectionClose);
        addEventListener("error", handleConnectionClose);
        addEventListener("open", handleConnectionOpen);
        addEventListener("message", handleMessage);
    }

    // Start the connection
    start();

    /**
     * Creates a proxy for method invocation
     * Supports both direct method calls and nested namespace access
     * @param {string} namespace - Base namespace for the method
     * @param {string} methodName - Method name
     * @returns {Proxy} Method proxy for invocation and namespace access
     */
    function createMethodProxy(namespace, methodName) {
        const fullyQualifiedMethodName = namespace === "" ? methodName : `${namespace}.${methodName}`;

        return new Proxy(async function () {
            const requestId = messageCounter++;
            const methodParameters = Array.prototype.slice.call(arguments, 0);
            const rpcRequest = {
                request: {
                    id: requestId,
                    method: fullyQualifiedMethodName,
                    params: methodParameters
                },
                // Set up timeout handler
                timeoutHandle: setTimeout(() => handleResponse(rpcRequest, response.setRpcError(rpcRequest.request.id, -32001, "Request timeout")), requestTimeout),
                eventEmitter: AsyncEvent()
            };

            try {
                // Verify connection state and send request
                if (!isConnectionOpen)
                    throw new Error("Connection is not open");

                sendMessage(JSON.stringify(rpcRequest.request));
                pendingRequests[requestId] = rpcRequest;
                pendingRequestCount++;
            }
            catch (error) {
                // Queue request for later if send fails
                pendingSubscriptions[requestId] = rpcRequest;
                pendingSubscriptionCount++;
            }

            // Wait for response
            await rpcRequest.eventEmitter.wait();

            // Handle error response
            if (rpcRequest.response.error) {
                const error = new Error(rpcRequest.response.error.message);
                error.code = rpcRequest.response.error.code;
                error.type = rpcRequest.response.error.type;
                error.data = rpcRequest.response.error.data;
                throw error;
            }

            return rpcRequest.response.result;
        }, {
            get: (target, methodName) => {
                if (typeof methodName === 'symbol' || methodName in target)
                    return target[methodName];

                return target[methodName] = createMethodProxy(fullyQualifiedMethodName, methodName);
            },
            set: (target, methodName, value) => {
                if (typeof methodName === 'symbol') {
                    target[methodName] = value;
                    return true;
                }
                throw new Error(`"${String(methodName)}" is read-only.`);
            }
        });
    }

    // Create and return the root method proxy
    const methodProxy = createMethodProxy("", "");
    Object.defineProperty(methodProxy, STATE_SYMBOL, {
        enumerable: false,
        configurable: false,
        writable: false,
        value: () => currentState
    });

    return methodProxy;
};

// Export the open function
module.exports = open;
