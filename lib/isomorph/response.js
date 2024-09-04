const jsonrpc_spec = require("./jsonrpc-spec");

function setRpcError(id, code, message = jsonrpc_spec.getMessageByCode(jsonrpc_spec.filterCodeType(code), code), data) {
    return {
        id: id,
        error: { code, message, data }
    };
}
exports.setRpcError = setRpcError;
