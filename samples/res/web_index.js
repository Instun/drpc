(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // lib/isomorph/jsonrpc-spec.js
  var require_jsonrpc_spec = __commonJS({
    "lib/isomorph/jsonrpc-spec.js"(exports) {
      var SPEC_CODE_MESSAGES = {
        "-32600": "Invalid Request.",
        "-32601": "Method not found.",
        "-32602": "Invalid params.",
        "-32603": "Internal error.",
        "-32700": "Parse error."
      };
      var SERVER_CODE_MESSAGES = {
        "-32000": "Server disconnected.",
        "-32001": "Request timeout."
      };
      var DEFAULT_SERVER_ERR = "Server error.";
      exports.CodeTypes = {
        "re_for_future": 0,
        "re_predefined": 1,
        "re_server_implementation": 2,
        "custom": 3
      };
      function filterCodeType(code) {
        let ctype = exports.CodeTypes["custom"];
        if (code >= -32768 && code <= -32e3) {
          ctype = exports.CodeTypes["re_for_future"];
          if (SPEC_CODE_MESSAGES.hasOwnProperty(code))
            ctype = exports.CodeTypes["re_predefined"];
          else if (code >= -32099)
            ctype = exports.CodeTypes["re_server_implementation"];
        } else
          ctype = exports.CodeTypes["custom"];
        return ctype;
      }
      exports.filterCodeType = filterCodeType;
      function getMessageByCode(ctype, code, fallback) {
        let message;
        if (fallback !== void 0)
          message = fallback;
        switch (ctype) {
          case exports.CodeTypes["re_for_future"]:
            break;
          case exports.CodeTypes["re_predefined"]:
            message = SPEC_CODE_MESSAGES[code];
            break;
          case exports.CodeTypes["re_server_implementation"]:
            message = SERVER_CODE_MESSAGES[code] || DEFAULT_SERVER_ERR;
            break;
          case exports.CodeTypes["custom"]:
            break;
        }
        return message;
      }
      exports.getMessageByCode = getMessageByCode;
      function mergeServerDefinedCodeMessages(provided) {
        return Object.assign({}, provided, SERVER_CODE_MESSAGES);
      }
      exports.mergeServerDefinedCodeMessages = mergeServerDefinedCodeMessages;
    }
  });

  // lib/isomorph/response.js
  var require_response = __commonJS({
    "lib/isomorph/response.js"(exports) {
      var jsonrpc_spec = require_jsonrpc_spec();
      function setRpcError(id, code, message = jsonrpc_spec.getMessageByCode(jsonrpc_spec.filterCodeType(code), code), data) {
        return {
          id,
          error: { code, message, data }
        };
      }
      exports.setRpcError = setRpcError;
    }
  });

  // lib/handler.js
  var require_handler = __commonJS({
    "lib/handler.js"(exports, module) {
      var response = require_response();
      var jsonrpc_spec = require_jsonrpc_spec();
      function resolve_method(routing, method) {
        let r = routing;
        var methods = method.split(".");
        do {
          if (typeof r !== "object")
            return;
          if (methods.length == 1) {
            r = r[methods[0]];
            break;
          }
          for (var l = methods.length; l > 0; l--) {
            const _method = methods.slice(0, l).join(".");
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
        if (typeof r !== "function")
          return;
        return r;
      }
      var handler = function(routing) {
        const invoke = async function(m) {
          let o2;
          try {
            if (typeof m !== "string")
              m = m.data;
            o2 = JSON.parse(m);
          } catch (e) {
            return response.setRpcError(-1, -32700);
          }
          let method = o2.method;
          if (!method)
            return response.setRpcError(o2.id, -32600);
          let params = o2.params;
          if (params === void 0)
            params = [];
          if (!Array.isArray(params))
            return response.setRpcError(o2.id, -32602);
          var f = resolve_method(routing, method);
          if (!f)
            return response.setRpcError(o2.id, -32601);
          let r;
          try {
            r = await f.apply(m, params);
          } catch (e) {
            return response.setRpcError(o2.id, -32603, e.message);
          }
          return {
            id: o2.id,
            result: r
          };
        };
        const _hdr = function(m) {
          const addEventListener = m.addEventListener ? m.addEventListener.bind(m) : m.addListener ? m.addListener.bind(m) : m.on.bind(m);
          async function rpc_handler(msg) {
            const r = JSON.stringify(await invoke(msg));
            if (m.postMessage)
              m.postMessage(r);
            else
              m.send(r);
          }
          addEventListener("message", rpc_handler);
        };
        return _hdr;
      };
      module.exports = handler;
    }
  });

  // node_modules/@instun/event/lib/index.js
  var require_lib = __commonJS({
    "node_modules/@instun/event/lib/index.js"(exports, module) {
      module.exports = function() {
        var resolvers = [];
        var state = false;
        return {
          wait: function() {
            var promise = new Promise((resolve, reject) => {
              if (state)
                resolve();
              else
                resolvers.push(resolve);
            });
            return promise;
          },
          set: function() {
            state = true;
            resolvers.forEach((resolve) => resolve());
          }
        };
      };
    }
  });

  // lib/open.js
  var require_open = __commonJS({
    "lib/open.js"(exports, module) {
      var response = require_response();
      var async_event = require_lib();
      var open = function(sock, opts) {
        opts = opts || {};
        let timeout = opts.timeout || 1e4;
        let id = 0;
        let is_open = opts.opened || false;
        let sq = {};
        let sq_cnt = 0;
        let rq = {};
        let rq_cnt = 0;
        function send_response(o2, v) {
          if (rq[o2.r.id]) {
            delete rq[o2.r.id];
            rq_cnt--;
          } else if (sq[o2.r.id]) {
            delete sq[o2.r.id];
            sq_cnt--;
          }
          o2.v = v;
          clearTimeout(o2.t);
          o2.e.set();
        }
        const addEventListener = sock.addEventListener ? sock.addEventListener.bind(sock) : sock.addListener ? sock.addListener.bind(sock) : sock.on.bind(sock);
        const send = sock.postMessage ? sock.postMessage.bind(sock) : sock.send.bind(sock);
        addEventListener("close", () => {
          for (const r in rq)
            send_response(rq[r], response.setRpcError(o.r.id, -32e3));
        });
        addEventListener("open", (m) => {
          for (const r in sq) {
            const o2 = sq[r];
            send(JSON.stringify(o2.r));
            rq[o2.r.id] = o2;
            rq_cnt++;
          }
          sq = {};
          sq_cnt = 0;
          is_open = true;
        });
        function on_timeout(o2) {
          send_response(o2, response.setRpcError(o2.r.id, -32001));
        }
        addEventListener("message", (m) => {
          if (typeof m !== "string")
            m = m.data;
          const v = JSON.parse(m);
          const o2 = rq[v.id];
          if (o2 === void 0) {
            console.log(`Unknown response id: ${v.id}`);
            return;
          }
          send_response(o2, v);
        });
        function method_func(base, name) {
          const func_name = base === "" ? name : `${base}.${name}`;
          return new Proxy(async function() {
            const _id = id++;
            const params = Array.prototype.slice.call(arguments, 0);
            const o2 = {
              r: {
                id: _id,
                method: func_name,
                params
              },
              t: setTimeout(() => on_timeout(o2), timeout),
              e: async_event()
            };
            try {
              if (!is_open)
                throw new Error("Connection is not open.");
              send(JSON.stringify(o2.r));
              rq[_id] = o2;
              rq_cnt++;
            } catch (e) {
              sq[_id] = o2;
              sq_cnt++;
            }
            await o2.e.wait();
            if (o2.v.error)
              throw new Error(o2.v.error.message);
            return o2.v.result;
          }, {
            get: (target, name2) => {
              if (!(name2 in target))
                return target[name2] = method_func(func_name, name2);
              return target[name2];
            },
            set: (target, name2, value) => {
              throw new Error(`"${name2}" is read-only.`);
            }
          });
        }
        return method_func("", "");
      };
      module.exports = open;
    }
  });

  // lib/index.js
  var require_lib2 = __commonJS({
    "lib/index.js"(exports) {
      exports.handler = require_handler();
      exports.open = require_open();
    }
  });

  // samples/res/common.js
  var require_common = __commonJS({
    "samples/res/common.js"(exports) {
      var rpc = require_lib2();
      async function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
      var test_func = function() {
      };
      test_func.test6 = async function(v1, v2) {
        await sleep(200);
        return v1 + v2;
      };
      exports.handler = rpc.handler({
        test: async function(v1, v2) {
          await sleep(200);
          return v1 + v2;
        },
        "test.test1": async function(v1, v2) {
          await sleep(200);
          return v1 + v2;
        },
        "test.test1.test2": async function(v1, v2) {
          await sleep(200);
          return v1 + v2;
        },
        test1: {
          test2: async function(v1, v2) {
            await sleep(200);
            return v1 + v2;
          },
          test3: {
            test4: async function(v1, v2) {
              await sleep(200);
              return v1 + v2;
            }
          }
        },
        test_func,
        timeout: async function(v1, v2) {
          await sleep(2e4);
          return v1 + v2;
        }
      });
      exports.test = async function(conn, opts) {
        const remoting = rpc.open(conn, {
          ...opts,
          timeout: 3e3
        });
        console.log(`remoting.test(1, 2) === ${await remoting.test(1, 2)}`);
        console.log(`remoting.test.test1(2, 3) === ${await remoting.test.test1(2, 3)}`);
        console.log(`remoting.test.test1.test2(3, 4) === ${await remoting.test.test1.test2(3, 4)}`);
        console.log(`remoting.test1.test2(4, 5) === ${await remoting.test1.test2(4, 5)}`);
        console.log(`remoting.test1.test3.test4(5, 6) === ${await remoting.test1.test3.test4(5, 6)}`);
        try {
          console.log(`remoting.timeout(5, 6) === ${await remoting.timeout(5, 6)}`);
        } catch (e) {
          console.log(e);
        }
        if (await remoting.test(1, 2) !== 3)
          console.log("test method is invalid.");
      };
    }
  });

  // samples/res/client.js
  var common = require_common();
  window.console = {
    log: function(msg) {
      document.getElementById("output").innerText += msg + "\n";
    }
  };
  async function main() {
    await common.test(window, {
      opened: true
    });
    window.close();
  }
  main();
})();
