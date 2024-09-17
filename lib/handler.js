const response = require("./isomorph/response");
const jsonrpc_spec = require("./isomorph/jsonrpc-spec");

function resolve_method(routing, method) {
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

    return r;
}

const handler = function (routing) {
    const invoke = async function (m) {
        let o;
        try {
            if (typeof m !== "string")
                m = m.data;
            o = JSON.parse(m);
        }
        catch (e) {
            return response.setRpcError(-1, -32700);
        }

        let method = o.method;
        if (!method)
            return response.setRpcError(o.id, -32600);

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
            r = await f.apply(m, params);
        }
        catch (e) {
            return response.setRpcError(o.id, -32603, e.message);
        }

        return {
            id: o.id,
            result: r
        };
    };

    const _hdr = function (m) {
        const addEventListener = m.addEventListener ?
            m.addEventListener.bind(m) :
            m.addListener ?
                m.addListener.bind(m) :
                m.on.bind(m);

        async function rpc_handler(msg) {
            const r = JSON.stringify(await invoke(msg));
            if (m.postMessage)
                m.postMessage(r);
            else
                m.send(r);
        }

        addEventListener('message', rpc_handler);
    };

    return _hdr;
};

module.exports = handler;
