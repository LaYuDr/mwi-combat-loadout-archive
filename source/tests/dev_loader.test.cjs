"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const loader = fs.readFileSync(path.join(__dirname, '../dev_loader.js'), 'utf8');
function harness() {
  let request; const injected = [], errors = [];
  const context = vm.createContext({ Date, console: { error: (...args) => errors.push(args) },
    document: { documentElement: {} }, GM_xmlhttpRequest: options => { request = options; },
    GM_addElement: (parent, tag, attributes) => { injected.push({ tag, attributes }); return { remove() {} }; } });
  vm.runInContext(loader, context);
  return { context, request, injected, errors };
}
test('loader requests fresh anonymous local runtime and runs only validated code', () => {
  const h = harness();
  assert.match(h.request.url, /^http:\/\/127\.0\.0\.1:4178\/runtime\.js\?cacheBust=\d+$/);
  assert.equal(h.request.anonymous, true); assert.equal(h.request.nocache, true);
  assert.equal(h.request.redirect, 'error');
  h.request.onload({ status: 503, responseText: '// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME\n' });
  h.request.onload({ status: 200, responseText: '// WRONG_PROJECT\n' });
  assert.equal(h.injected.length, 0); assert.equal(h.errors.length, 2);
  h.request.onload({ status: 200, responseText: '// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME\nwindow.test = 1;' });
  assert.equal(h.injected.length, 1); assert.equal(h.injected[0].tag, 'script');
  vm.runInContext(loader, h.context); assert.equal(h.injected.length, 1);
});
