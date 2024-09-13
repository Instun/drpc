const response = require("./isomorph/response");
const async_event = require("@instun/event");

const open = function (sock) {
    let id = 0;

    /* send queue */
    let sq = {};
    let sq_cnt = 0;

    /* response queue */
    let rq = {};
    let rq_cnt = 0;

    let is_open = false;

    sock.addEventListener("close", () => {
        if (rq_cnt) {
            for (const r in rq) {
                const o = rq[r];
                o.v = response.setRpcError(o.r.id, -32000);
                o.e.set();
            }
            rq = {};
            rq_cnt = 0;
        }
    });

    sock.addEventListener("open", (m) => {
        if (sq_cnt) {
            for (const r in sq) {
                const o = sq[r];
                sock.send(JSON.stringify(o.r));
                rq[o.r.id] = o;
                rq_cnt++;
            }
            sq = {};
            sq_cnt = 0;
        }

        is_open = true;
    });

    sock.addEventListener("message", (m) => {
        const v = JSON.parse(m.data);

        const o = rq[v.id];
        if (o !== undefined) {
            delete rq[v.id];
            rq_cnt--;
        }

        o.v = v;
        o.e.set();
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
                e: async_event()
            };

            try {
                if (!is_open)
                    throw new Error("Connection is not open.");

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
