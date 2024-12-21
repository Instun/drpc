/**
 * @fileoverview Method routing implementation for RPC.
 * Provides support for method routing with middleware chains and nested routing configurations.
 */

const response = require("./isomorph/response");


/**
 * Creates a method handler based on the routing configuration.
 * Supports three types of configurations:
 * 1. Function - Direct method handler
 * 2. Array - Middleware chain where each handler can modify the context
 * 3. Object - Nested method routing with dot notation support
 * 
 * @param {Function|Array|Object} handlers - The routing configuration
 * @returns {Function} An async function that handles method calls
 * @throws {Error} If the configuration is invalid or method is not found
 */
function wrapMethodHandler(handlers) {
    // Handle primitive values
    if (handlers === null || handlers === undefined)
        return () => handlers;

    // If handlers is a function, return it directly as the handler
    if (typeof handlers === 'function')
        return handlers;

    // Handle array of handlers (middleware chain)
    if (Array.isArray(handlers)) {
        const methodHandlers = handlers.map(wrapMethodHandler);

        return async function () {
            // Create a new context for the chain
            const rpcMessage = this;
            const callMessage = {
                ...rpcMessage
            };

            let result;

            // Execute each handler in the chain sequentially
            for (let i = 0; i < methodHandlers.length; i++) {
                let methodArguments = callMessage.params;
                if (methodArguments === undefined)
                    methodArguments = [];
                if (!Array.isArray(methodArguments))
                    throw response.setRpcError(callMessage.id, -32602);

                // Apply the handler and get result
                result = await methodHandlers[i].apply(callMessage, methodArguments);

                // Only the last handler in the chain can return a value
                if (result !== undefined && i < methodHandlers.length - 1)
                    throw response.setRpcError(callMessage.id, -32603, "Only the last handler in the chain can return a value");
            }

            return result;
        };
    }

    // Handle object of nested methods (e.g., "user.profile.get")
    if (typeof handlers === 'object') {
        const methodHandler = {};

        // Recursively wrap each method in the object
        for (const methodName in handlers)
            methodHandler[methodName] = wrapMethodHandler(handlers[methodName]);

        return async function () {
            const rpcMessage = this;
            let methodArguments = rpcMessage.params;
            if (methodArguments === undefined)
                methodArguments = [];
            if (!Array.isArray(methodArguments))
                throw response.setRpcError(rpcMessage.id, -32602);

            // Split method path into segments (e.g., "user.profile.get" -> ["user", "profile", "get"])
            let methodParts = rpcMessage.method.split('.');
            let currentNode = methodHandler;

            // Handle direct method call (no dots)
            if (methodParts.length == 1) {
                currentNode = currentNode[methodParts[0]];
            } else {
                // Find the longest matching prefix handler
                // This allows for flexible routing like "user.*" or "user.profile.*"
                for (var prefixLength = methodParts.length; prefixLength > 0; prefixLength--) {
                    const methodPath = methodParts.slice(0, prefixLength).join('.');
                    var resolvedMethodHandler = currentNode[methodPath];

                    if (resolvedMethodHandler) {
                        currentNode = resolvedMethodHandler;
                        methodParts = methodParts.slice(prefixLength);
                        break;
                    }
                }

                // If no matching handler found, throw method not found error
                if (prefixLength == 0)
                    throw response.setRpcError(rpcMessage.id, -32601);
            }

            // Create context for the handler with remaining path segments
            const callMessage = {
                ...rpcMessage,
                method: methodParts.join('.')
            };

            return await currentNode.apply(callMessage, rpcMessage.params);
        };
    }

    // Handle primitive values by returning them directly
    return async function () {
        return handlers;
    };
}

module.exports = wrapMethodHandler;
