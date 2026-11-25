'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { OpenCodeV2 } = require('../lib/opencode');

test('v2 adapter uses the session API and queues text once', async t => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, url: req.url, body: body && JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { id: 'ses_test' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const api = new OpenCodeV2(`http://127.0.0.1:${server.address().port}`);
  const session = await api.createSession('Review');
  await api.sendPrompt(session.id, 'Review this PR');
  await api.interrupt(session.id);
  assert.deepEqual(calls.map(call => [call.method, call.url]), [
    ['POST', '/api/session'], ['POST', '/api/session/ses_test/prompt'], ['POST', '/api/session/ses_test/interrupt'],
  ]);
  assert.deepEqual(calls[1].body, { text: 'Review this PR' });
  assert.throws(() => new OpenCodeV2('http://example.com:4096'));
});
