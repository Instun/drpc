const jsonrpc_spec = require("./isomorph/jsonrpc-spec");

/**
 * @notice once predefined errMsgs provided, message is determined by code absolutely.
 */
class RpcError extends Error {
    constructor(input) {
        if (typeof input === 'string' || typeof input === 'number') {
            const args = Array.prototype.slice.call(arguments);
            input = { code: input, message: args[1], data: args[2] };
        }
        let { code = -32000, message, data } = input;
        code = parseInt(code, 10);
        const ctype = jsonrpc_spec.filterCodeType(code);
        if (ctype === jsonrpc_spec.CodeTypes['re_for_future'])
            throw new Error(`[RpcError]never use reserved code for future`);
        message = jsonrpc_spec.getMessageByCode(ctype, code, message);
        super(message);
        this.name = 'RpcError';
        this.code = code;
        this.data = data;
    }
}
exports.RpcError = RpcError;
function rpcError(code, message, data = undefined) {
    if (typeof code === 'string')
        code = parseInt(code);
    return new RpcError({ code, message, data });
}
exports.rpcError = rpcError;
