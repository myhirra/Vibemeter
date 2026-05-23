/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require('node:module');

const load = Module._load;

Module._load = function vibemeterLoad(request, parent, isMain) {
  if (/^better-sqlite3-[a-f0-9]+$/.test(request)) {
    return load.call(this, 'better-sqlite3', parent, isMain);
  }
  return load.call(this, request, parent, isMain);
};
