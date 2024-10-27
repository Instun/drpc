# @instun/drpc

## Overview

@instun/drpc is a lightweight, flexible, and efficient library for handling JSON-RPC communication. It is designed to work seamlessly in various JavaScript environments, including web browsers, Node.js, Fibjs, and React Native. This versatility makes it an ideal choice for projects that require a unified interface for remote procedure calls across different platforms. Additionally, drpc is compatible with a wide range of connection objects, such as WebSocket, WebRTC, IPC, Worker, and custom message queues. This broad compatibility ensures that @instun/drpc can be used in a variety of scenarios, from real-time web applications to complex server-side systems and mobile applications.

The library is designed to be lightweight, ensuring minimal overhead and high performance. This efficiency is crucial for applications that require low latency and high throughput. @instun/drpc is also easy to integrate with existing projects, minimizing setup time and allowing developers to quickly add JSON-RPC capabilities to their applications. The library fully adheres to the JSON-RPC 2.0 specification, ensuring compatibility with other JSON-RPC implementations and providing a reliable and standardized communication protocol.

## Features

- **JSON-RPC 2.0 Compliant**: @instun/drpc fully adheres to the JSON-RPC 2.0 specification, ensuring compatibility with other JSON-RPC implementations and providing a reliable and standardized communication protocol. This compliance guarantees that the library can be used in a wide range of applications and environments without compatibility issues.

- **Cross-Platform Support**: The library is designed to work seamlessly in various JavaScript environments, including web browsers, Node.js, Fibjs, and React Native. This versatility makes it an ideal choice for projects that require a unified interface for remote procedure calls across different platforms. Whether you are developing a web application, a server-side application, or a mobile application, @instun/drpc provides the tools you need to implement robust and efficient JSON-RPC communication.

- **Client and Server Implementations**: @instun/drpc provides robust support for both client and server-side JSON-RPC. This dual support allows developers to implement JSON-RPC communication in both client and server applications, enabling seamless communication between different parts of an application or between different applications.

- **Bidirectional RPC**: The library supports bidirectional RPC, allowing the server to initiate RPC calls to the client based on the APIs exposed by the client. This feature is useful in scenarios where the server needs to request information or trigger actions on the client, enabling more interactive and dynamic communication between the client and server.

- **Easy Integration**: @instun/drpc is designed to be easy to integrate with existing projects, minimizing setup time and allowing developers to quickly add JSON-RPC capabilities to their applications. The library provides a simple and intuitive API, making it easy to implement JSON-RPC communication without extensive configuration or setup.

- **Lightweight and Efficient**: The library is lightweight, ensuring minimal overhead and high performance. This efficiency makes it suitable for use in performance-critical applications where low latency and high throughput are essential.

- **Automatic Reconnection**: @instun/drpc includes built-in support for automatic reconnection in case of connection loss. This feature ensures that the communication between the client and server remains reliable and resilient, even in the face of network interruptions or other connectivity issues.

- **Error Handling**: The library provides comprehensive error handling and reporting mechanisms, allowing developers to easily detect and handle errors in JSON-RPC communication. This robust error handling ensures that applications can gracefully recover from errors and continue to function correctly.

- **Asynchronous Communication**: @instun/drpc supports asynchronous communication, making it suitable for modern web applications that require non-blocking communication between the client and server. This feature allows developers to implement efficient and responsive applications that can handle multiple concurrent requests and responses.

- **Rich Connection Object Compatibility**: @instun/drpc is compatible with various connection objects, including WebSocket, WebRTC, IPC, Worker, and custom message queues. This broad compatibility ensures that the library can be used in a variety of scenarios, from real-time web applications to complex server-side systems and mobile applications. This flexibility allows developers to choose the most appropriate connection method for their specific use case, ensuring optimal performance and reliability.

## Installation

You can install @instun/drpc via npm:

```sh
npm install @instun/drpc
```

## Usage

### Server

To create a JSON-RPC server, you can use the `handler` function from the library:

```js
const rpc = require('@instun/drpc');
const ws = reuire('ws');
const http = reuire('http');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const svr = new http.Server(8811, ws.upgrade(rpc.handler({
    test: async function (v1, v2) {
        await sleep(200);
        return v1 + v2;
    }
}));
svr.start();
```

### Client

To create a JSON-RPC client, you can use the `open` function from the library:

```js
const rpc = require('@instun/drpc');
const ws = reuire('ws');

const remoting = rpc.open(function () {
    return new ws.Socket("ws://127.0.0.1:8811")
});

await remoting.test(1, 2);
```

### Bidirectional RPC

@instun/drpc supports bidirectional RPC, allowing the server to initiate RPC calls to the client. This is useful in scenarios where the server needs to request information or trigger actions on the client.

Example:

```js
// Client-side
const rpc = require('@instun/drpc');
const ws = reuire('ws');

const remoting = rpc.open(function () {
    return new ws.Socket("ws://127.0.0.1:8811")
}, {
    routing: {
        client_callback: async function (v1, v2) {
            return "client_callback result: " + (v1 + v2);
        }
    }
});

await remoting.test(1, 2);

// Server-side
const rpc = require('@instun/drpc');
const ws = reuire('ws');
const http = reuire('http');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const svr = new http.Server(8811, ws.upgrade(rpc.handler({
    test: async function (v1, v2) {
        await sleep(200);
        return await this.client_callback(v1, v2);
    }
}));
svr.start();
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

Special thanks to all the contributors who have helped in the development of this project.

## Contact

For any questions or feedback, please open an issue on our [GitHub repository](https://github.com/Instun/drpc).
