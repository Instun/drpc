const response = require("./isomorph/response");
const async_event = require("@instun/event");

const symbol_conn = Symbol.for("conn");

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

const open = function (conn, opts) {
    opts = opts || {};
    let timeout = opts.timeout || 10000;
    let id = 0;
    let is_open = opts.opened || false;
    let routing = opts.routing || {};

    /* send queue */
    let sq = {};
    let sq_cnt = 0;

    /* response queue */
    let rq = {};
    let rq_cnt = 0;

    var send;

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
            return response.setRpcError(o.id, -32603, e.message);
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

    function start() {
        send = conn.postMessage ? conn.postMessage.bind(conn) : conn.send.bind(conn);

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
                    send_result(rq[r], response.setRpcError(rq[r].r.id, -32000));
                if (open) {
                    conn = open();
                    start();
                }
            }
        }

        addEventListener("close", on_close);
        addEventListener("exit", on_close);
        addEventListener("error", on_close);

        addEventListener("open", (m) => {
            for (const r in sq) {
                const o = sq[r];
                send(JSON.stringify(o.r));
                rq[o.r.id] = o;
                rq_cnt++;
            }
            sq = {};
            sq_cnt = 0;

            is_open = true;
        });

        addEventListener("message", async (msg) => {
            if (typeof msg !== "string")
                msg = msg.data;
            const v = JSON.parse(msg);

            if (typeof v.method === 'string') {
                send(JSON.stringify(await invoke(v)));
            } else {
                const o = rq[v.id];
                if (o === undefined) {
                    console.log(`Unknown response id: ${v.id}`);
                    return;
                }

                send_result(o, v);

            }
        });
    }

    start();

    function method_func(base, name) {
        const func_name = base === "" ? name : `${base}.${name}`;

        return new Proxy(async function () {
            const _id = id++;
            const params = Array.prototype.slice.call(arguments, 0);
            const o = {
                r: {
                    id: _id,
                    method: func_name,
                    params: params
                },
                t: setTimeout(() => send_result(o, response.setRpcError(o.r.id, -32001)), timeout),
                e: async_event()
            };

            try {
                if (!is_open)
                    throw new Error("Connection is not open.");

                send(JSON.stringify(o.r));

                rq[_id] = o;
                rq_cnt++;
            }
            catch (e) {
                sq[_id] = o;
                sq_cnt++;
            }

            await o.e.wait();

            if (o.v.error)
                throw new Error(o.v.error.message);

            return o.v.result;
        }, {
            get: (target, name) => {
                if (name === symbol_conn)
                    return conn;
                if (!(name in target))
                    return target[name] = method_func(func_name, name);
                return target[name];
            },
            set: (target, name, value) => {
                throw new Error(`"${name}" is read-only.`);
            }
        });
    }

    const _method = method_func("", "");
    return _method;
};

module.exports = open;
