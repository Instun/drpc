const error = require("./error");
const response = require("./isomorph/response");
const jsonrpc_spec = require("./isomorph/jsonrpc-spec");

const handler = function (func, opts = {}) {
    const { allow_anytype_params = false, log_error_stack = true, } = opts || {};
    let { server_error_messages = {}, interceptor = undefined } = opts || {};
    const shouldSelect = typeof interceptor === 'function';

    server_error_messages = jsonrpc_spec.mergeServerDefinedCodeMessages(server_error_messages);

    const invoke = async function (m) {
        let o;
        try {
            o = JSON.parse(m.data);
        }
        catch (e) {
            return response.setRpcError(-1, -32700);
        }

        let method = o.method;
        if (!method)
            return response.setRpcError(o.id, -32600);
        let params = o.params;

        if (!allow_anytype_params) {
            if (params === undefined)
                params = [];
            if (!Array.isArray(params))
                return response.setRpcError(o.id, -32602);
        }

        let selected;
        let f;

        if (typeof func !== 'function') {
            f = func[method];

            if (typeof f !== 'function' && (selected = shouldSelect && interceptor(o))) {
                switch (typeof selected) {
                    case 'string':
                        f = func[selected];
                        break;
                    case 'function':
                        f = selected;
                        break;
                }
            }

            if (!f)
                return response.setRpcError(o.id, -32601);
        }
        else {
            f = func;
        }

        let r;
        try {
            r = await f[allow_anytype_params ? 'call' : 'apply'](m, params);
        }
        catch (e) {
            if (log_error_stack)
                console.error(e.stack);
            if (e instanceof error.RpcError)
                return response.setRpcError(o.id, e.code, e.message || server_error_messages[e.code], e.data);
            return response.setRpcError(o.id, -32603);
        }

        return {
            id: o.id,
            result: r
        };
    };

    const _hdr = function (m) {
        m.addEventListener('message', async function (msg) {
            m.send(JSON.stringify(await invoke(msg)));
        });
    };

    return _hdr;
};

module.exports = handler;
