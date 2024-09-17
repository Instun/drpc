const { parentPort } = require('worker_threads');

const common = require('./common.js')

common.handler(parentPort);
