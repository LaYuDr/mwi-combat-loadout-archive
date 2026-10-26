"use strict";
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createServer } = require('../dev_server.cjs');
async function withServer(build, run) {
  const server = createServer(build); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, path: url, headers, method }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject).end();
  });
  try { await run(request); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('server rebuilds allowed paths, denies foreign hosts/origins and does not serve stale output on failure', async () => {
  let count = 0, fail = false;
  await withServer(() => { count++; if (fail) throw Error('synthetic build failure'); }, async request => {
    const a = await request('/runtime.js?cacheBust=1');
    assert.equal(a.status, 200); assert.equal(a.headers['cache-control'], 'no-store');
    assert.ok(a.body.startsWith('// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME\n'));
    await request('/runtime.js?cacheBust=2'); assert.equal(count, 2);
    assert.equal((await request('/runtime.js', { Host: 'evil.example' })).status, 403);
    assert.equal((await request('/runtime.js', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/../../package.json')).status, 404);
    assert.equal((await request('/runtime.js', {}, 'POST')).status, 405);
    fail = true; const b = await request('/runtime.js'); assert.equal(b.status, 503);
    assert.ok(!b.body.includes('MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME'));
  });
});
