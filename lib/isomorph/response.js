const jsonrpc_spec = require("./jsonrpc-spec");
const { StandardErrorCodes, ErrorTypes, createError, parseError } = require("./errors");

/**
 * Set RPC error response
 * @param {string|number} id Request ID
 * @param {number} code Error code
 * @param {string} [message] Error message
 * @param {*} [data] Additional data
 * @returns {Object} Error response object
 */
function setRpcError(id, code, message, data) {
    // If no message provided, use standard error message
    if (!message) {
        message = jsonrpc_spec.getMessageByCode(jsonrpc_spec.filterCodeType(code), code);
    }

    // Determine error type based on error code
    let type = ErrorTypes.SYSTEM;
    if (code === StandardErrorCodes.PARSE_ERROR || code === StandardErrorCodes.INVALID_REQUEST) {
        type = ErrorTypes.PROTOCOL;
    } else if (code === StandardErrorCodes.METHOD_NOT_FOUND || code === StandardErrorCodes.INVALID_PARAMS) {
        type = ErrorTypes.BUSINESS;
    } else if (code === StandardErrorCodes.SERVER_ERROR || code === StandardErrorCodes.TIMEOUT_ERROR) {
        type = ErrorTypes.NETWORK;
    }

    const error = createError(code, message, type, data);
    return { id, ...error };
}

/**
 * Handle error and generate standard error response
 * @param {string|number} id Request ID
 * @param {Error|Object} error Error object
 * @returns {Object} Standard error response
 */
function handleError(id, error) {
    const standardError = parseError(error);
    return { id, ...standardError };
}

exports.setRpcError = setRpcError;
exports.handleError = handleError;
