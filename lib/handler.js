const open = require("./open");

const handler = function (routing, opts) {
    opts = opts || {};

    const _hdr = function (conn) {
        open(conn, {
            ...opts,
            opened: true,
            routing: routing
        });
    };

    return _hdr;
};

module.exports = handler;
