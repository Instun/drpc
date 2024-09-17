/**
 * @see https://www.jsonrpc.org/specification
 */
const SPEC_CODE_MESSAGES = {
    '-32600': "Invalid Request.",
    '-32601': "Method not found.",
    '-32602': "Invalid params.",
    '-32603': "Internal error.",
    '-32700': "Parse error.",
};

const SERVER_CODE_MESSAGES = {
    '-32000': 'Server disconnected.',
    '-32001': 'Request timeout.',
};

const DEFAULT_SERVER_ERR = 'Server error.';
exports.CodeTypes = {
    're_for_future': 0,
    're_predefined': 1,
    're_server_implementation': 2,
    'custom': 3,
};

function filterCodeType(code) {
    let ctype = exports.CodeTypes['custom'];
    if (code >= -32768 && code <= -32000) {
        ctype = exports.CodeTypes['re_for_future'];
        if (SPEC_CODE_MESSAGES.hasOwnProperty(code))
            ctype = exports.CodeTypes['re_predefined'];
        else if (code >= -32099)
            ctype = exports.CodeTypes['re_server_implementation'];
    }
    else
        ctype = exports.CodeTypes['custom'];
    return ctype;
}
exports.filterCodeType = filterCodeType;

function getMessageByCode(ctype, code, fallback) {
    let message;
    if (fallback !== undefined)
        message = fallback;
    switch (ctype) {
        case exports.CodeTypes['re_for_future']:
            break;
        case exports.CodeTypes['re_predefined']:
            message = SPEC_CODE_MESSAGES[code];
            break;
        case exports.CodeTypes['re_server_implementation']:
            message = SERVER_CODE_MESSAGES[code] || DEFAULT_SERVER_ERR;
            break;
        case exports.CodeTypes['custom']:
            break;
    }
    return message;
}
exports.getMessageByCode = getMessageByCode;

function mergeServerDefinedCodeMessages(provided) {
    return Object.assign({}, provided, SERVER_CODE_MESSAGES);
}
exports.mergeServerDefinedCodeMessages = mergeServerDefinedCodeMessages;
