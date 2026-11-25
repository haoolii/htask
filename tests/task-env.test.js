'use strict';

const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { modelRef, readTaskEnv } = require('../lib/task-env');

test('task config uses only supported variables from the local .env', t => {
  const dir = mkdtempSync(join(tmpdir(), 'htask-env-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, '.env');
  assert.deepEqual(readTaskEnv(file), {});
  writeFileSync(file, 'OPENAI_API_KEY="dummy#key"\nOPENCODE_PASSWORD=ignored\nPATH=ignored\nOPENCODE_MODEL=openai/test-model\n');
  assert.deepEqual(readTaskEnv(file), {
    OPENAI_API_KEY: 'dummy#key',
    OPENCODE_MODEL: 'openai/test-model',
  });
  writeFileSync(file, 'OPENCODE_MODEL=missing-provider\n');
  assert.throws(() => readTaskEnv(file), /OPENCODE_MODEL must use/);
});

test('preserves provider model IDs containing a slash and optional variants', () => {
  assert.deepEqual(modelRef('openrouter/anthropic/model#high'), {
    providerID: 'openrouter', id: 'anthropic/model', variant: 'high',
  });
  assert.equal(modelRef(undefined), undefined);
});
