'use strict';

const fs = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const { OpenCodeV2 } = require('./opencode');
const { modelRef } = require('./task-env');
const { mcp } = require('/home/vscode/.config/opencode/opencode.json');

const input = '/tmp/htask-input';
const status = '/tmp/htask-status.json';
const run = { state: 'waiting-for-server', sessionId: null };

function save(state, extra = {}) {
  Object.assign(run, { state }, extra);
  fs.writeFileSync(`${status}.tmp`, JSON.stringify(run), { mode: 0o600 });
  fs.renameSync(`${status}.tmp`, status);
}

async function main() {
  const prompt = fs.readFileSync(input, 'utf8');
  fs.unlinkSync(input);
  save('waiting-for-server');
  const base = 'http://127.0.0.1:4096';
  const password = process.env.OPENCODE_PASSWORD;
  const probe = new OpenCodeV2(base, 1000, password);
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      await probe.request('GET', '/api/info');
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(500);
    }
  }
  const api = new OpenCodeV2(base, 120000, password);
  const servers = await api.request('GET', '/api/mcp');
  const playwright = servers.data.find(server => server.name === 'playwright');
  if (!playwright) {
    await api.request('PUT', '/api/experimental/mcp/playwright', { config: mcp.servers.playwright });
  }
  if (!playwright || playwright.status.status === 'pending') {
    await api.request('POST', '/api/experimental/mcp/playwright/connect');
  }
  const model = fs.existsSync('/workspace/opencode.jsonc') ? undefined : modelRef(process.env.OPENCODE_MODEL);
  const session = await api.createSession(process.argv[2], model);
  save('submitting-prompt', { sessionId: session.id });
  await api.sendPrompt(session.id, prompt, { resume: true });
  save('prompt-accepted');
}

main().catch(error => {
  const message = error.name === 'TimeoutError'
    ? 'OpenCode request timed out; prompt delivery may be unknown and was not retried.'
    : error.message;
  save('error', { error: message });
  process.exitCode = 1;
});
