const response = require("./isomorph/response");
const error = require("./error");

function async_event() {
    var resolvers = [];
    var state = false;

    return {
        wait: function () {
            var promise = new Promise((resolve, reject) => {
                if (state)
                    resolve();
                else
                    resolvers.push(resolve);
            });

            return promise;
        },
        set: function () {
            state = true;
            resolvers.forEach(resolve => resolve());
        }
    };
}

const open = function (sock, opts) {
    let id = 0;
    const { open: use_open_handler = false, log_error_stack = true, throw_error = false } = opts || {};

    /* send queue */
    let sq = {};
    let sq_cnt = 0;

    /* response queue */
    let rq = {};
    let rq_cnt = 0;

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

    sock.addEventListener("error", (evt) => {
        if (log_error_stack)
            console.error(evt);
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

    return new Proxy({}, {
        get: (target, name) => {
            if (!(name in target)) {
                return target[name] = async function () {
                    const _id = id++;
                    const params = Array.prototype.slice.call(arguments, 0);
                    const o = {
                        r: {
                            id: _id,
                            method: name,
                            params: use_open_handler ? params[0] : params
                        },
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

                    if (o.v.error) {
                        if (!throw_error)
                            throw o.v.error.message;
                        else
                            throw error.rpcError(o.v.error.code, o.v.error.message, o.v.error.data);
                    }
                    return o.v.result;
                };
            }
            return target[name];
        },
        set: (target, name, value) => {
            throw `"${name}" is read-only.`;
        }
    });
};

module.exports = open;
