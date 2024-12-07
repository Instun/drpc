// JSON-RPC 2.0 Standard Error Codes
const StandardErrorCodes = {
    PARSE_ERROR: -32700,        // Parse error
    INVALID_REQUEST: -32600,    // Invalid request
    METHOD_NOT_FOUND: -32601,   // Method not found
    INVALID_PARAMS: -32602,     // Invalid parameters
    INTERNAL_ERROR: -32603,     // Internal error
    SERVER_ERROR: -32000,       // Server error
    TIMEOUT_ERROR: -32001       // Timeout error
};

// Custom error codes range: -32099 to -32000 reserved for implementation-defined server errors
const CustomErrorCodes = {
    CONNECTION_ERROR: -32099,   // Connection error
    VALIDATION_ERROR: -32098,   // Validation error
    AUTHORIZATION_ERROR: -32097 // Authorization error
};

// Error type definitions
const ErrorTypes = {
    NETWORK: 'NETWORK',         // Network-related errors
    PROTOCOL: 'PROTOCOL',       // Protocol-related errors
    BUSINESS: 'BUSINESS',       // Business-related errors
    SYSTEM: 'SYSTEM'           // System-related errors
};

/**
 * Create a standard format RPC error object
 * @param {number} code Error code
 * @param {string} message Error message
 * @param {string} type Error type
 * @param {*} [data] Additional data
 * @returns {Object} Error object
 */
function createError(code, message, type, data) {
    return {
        error: {
            code,
            message,
            type,
            data
        }
    };
}

/**
 * Parse error information and generate standard error object
 * @param {Error} error Original error object
 * @returns {Object} Standard error object
 */
function parseError(error) {
    // If already in standard format, return directly
    if (error && error.error && typeof error.error.code === 'number') {
        return error;
    }

    // Generate standard error based on error type
    if (error instanceof SyntaxError) {
        return createError(
            StandardErrorCodes.PARSE_ERROR,
            error.message,
            ErrorTypes.PROTOCOL
        );
    }

    if (error instanceof TypeError) {
        return createError(
            StandardErrorCodes.INVALID_PARAMS,
            error.message,
            ErrorTypes.PROTOCOL
        );
    }

    // Default to internal error handling
    return createError(
        StandardErrorCodes.INTERNAL_ERROR,
        error.message || 'Internal error',
        ErrorTypes.SYSTEM
    );
}

module.exports = {
    StandardErrorCodes,
    CustomErrorCodes,
    ErrorTypes,
    createError,
    parseError
};
