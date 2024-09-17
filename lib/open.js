const response = require("./isomorph/response");
const async_event = require("@instun/event");

const open = function (sock, opts) {
    opts = opts || {};
    let timeout = opts.timeout || 10000;
    let id = 0;

    /* send queue */
    let sq = {};
    let sq_cnt = 0;

    /* response queue */
    let rq = {};
    let rq_cnt = 0;


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

    sock.addEventListener("close", () => {
        for (const r in rq)
            send_response(rq[r], response.setRpcError(o.r.id, -32000));
    });

    sock.addEventListener("open", (m) => {
        for (const r in sq) {
            const o = sq[r];
            sock.send(JSON.stringify(o.r));
            rq[o.r.id] = o;
            rq_cnt++;
        }
        sq = {};
        sq_cnt = 0;
    });

    function on_timeout(o) {
        send_response(o, response.setRpcError(o.r.id, -32001));
    }

    sock.addEventListener("message", (m) => {
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
                t: setTimeout(() => on_timeout(o), timeout),
                e: async_event()
            };

            try {
                sock.send(JSON.stringify(o.r));

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
