const response = require("./isomorph/response");
const async_event = require("@instun/event");

const open = function (sock, opts) {
    opts = opts || {};
    let timeout = opts.timeout || 10000;
    let id = 0;
    let is_open = opts.opened || false;

    /* send queue */
    let sq = {};
    let sq_cnt = 0;

    /* response queue */
    let rq = {};
    let rq_cnt = 0;

    var send;

    function send_response(o, v) {
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

    var open;
    if (typeof sock === 'function') {
        open = sock;
        sock = open();
    }

    function start() {
        send = sock.postMessage ? sock.postMessage.bind(sock) : sock.send.bind(sock);

        const addEventListener = sock.addEventListener ?
            sock.addEventListener.bind(sock) :
            sock.addListener ?
                sock.addListener.bind(sock) :
                sock.on.bind(sock);

        var is_closed = false;
        function on_close() {
            if (!is_closed) {
                is_closed = true;
                for (const r in rq)
                    send_response(rq[r], response.setRpcError(rq[r].r.id, -32000));
                if (open)
                {
                    sock = open();
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

        addEventListener("message", (m) => {
            if (typeof m !== "string")
                m = m.data;
            const v = JSON.parse(m);

            const o = rq[v.id];
            if (o === undefined) {
                console.log(`Unknown response id: ${v.id}`);
                return;
            }

            send_response(o, v);
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
                t: setTimeout(() => send_response(o, response.setRpcError(o.r.id, -32001)), timeout),
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
                if (!(name in target))
                    return target[name] = method_func(func_name, name);
                return target[name];
            },
            set: (target, name, value) => {
                throw new Error(`"${name}" is read-only.`);
            }
        });
    }

    return method_func("", "");
};

module.exports = open;
